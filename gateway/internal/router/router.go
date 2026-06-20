package router

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/encorehub/gateway/internal/engine"
	"github.com/encorehub/gateway/internal/handler"
	"github.com/encorehub/gateway/internal/metrics"
	"github.com/encorehub/gateway/internal/provider"
	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// requestIDHeader is the canonical header gateway emits / honours.
const requestIDHeader = "X-Request-ID"

// Config holds dependencies for the router.
type Config struct {
	Registry     *provider.Registry
	Engine       *engine.Client
	ProfileStore *handler.ProfileStore
}

// Setup builds the Gin router with all middleware and routes.
func Setup(cfg Config) *gin.Engine {
	r := gin.New()

	// Middleware (order matters: request-id -> CORS -> rate limit -> metrics -> auth)
	r.Use(requestIDMiddleware())
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	r.Use(corsMiddleware())
	r.Use(rateLimitMiddleware())
	r.Use(metrics.Middleware())

	// Handlers
	convHandler := handler.NewConversationHandler(cfg.Engine)
	chatHandler := handler.NewChatHandler(cfg.Registry, cfg.Engine)
	providerHandler := handler.NewProviderHandler(cfg.Registry, cfg.ProfileStore)
	searchHandler := handler.NewSearchHandler()
	engineProxy := handler.NewEngineProxy(cfg.Engine)
	healthHandler := handler.NewHealthHandler(cfg.Engine)

	// Health is unauthenticated to support container probes.
	r.GET("/api/v1/health", healthHandler.Get)

	// Prometheus exposition — public on purpose; same convention as kube /metrics.
	r.GET("/metrics", metrics.Handler())

	api := r.Group("/api/v1")
	api.Use(authMiddleware())
	{
		// Conversations (proxied to engine)
		conv := api.Group("/conversations")
		{
			conv.POST("", convHandler.Create)
			conv.GET("", convHandler.List)
			conv.GET("/:id", convHandler.Get)
			conv.PATCH("/:id", convHandler.Rename)
			conv.DELETE("/:id", convHandler.Delete)

			// Chat endpoint (gateway handles AI provider calls)
			conv.POST("/:id/chat", chatHandler.SendMessage)
		}

		// Search
		api.POST("/search", searchHandler.Search)

		// Providers
		prov := api.Group("/providers")
		{
			prov.GET("", providerHandler.ListProviders)
			prov.PUT("", providerHandler.UpdateProviders)
			prov.GET("/:provider/models", providerHandler.ListModels)
		}

		// Engine resources (skills / memories / knowledge / secrets): transparent
		// proxy. All standard CRUD verbs land on the proxy; engine enforces shape.
		// Secrets carry key material — they ride the same localhost trust boundary
		// as the X-Provider-Key header the gateway already forwards.
		for _, res := range []string{"skills", "memories", "knowledge", "secrets"} {
			api.Any("/"+res, engineProxy.Forward)
			api.Any("/"+res+"/*rest", engineProxy.Forward)
		}
	}

	return r
}

// allowedOrigins is the CORS allowlist. Extend via ENCOREHUB_CORS_ORIGINS
// (comma-separated) for additional dev hosts.
var allowedOrigins = func() map[string]struct{} {
	defaults := []string{
		"tauri://localhost",
		"https://tauri.localhost",
		"http://localhost:1420",
		"http://127.0.0.1:1420",
	}
	if extra := os.Getenv("ENCOREHUB_CORS_ORIGINS"); extra != "" {
		for _, o := range strings.Split(extra, ",") {
			if o = strings.TrimSpace(o); o != "" {
				defaults = append(defaults, o)
			}
		}
	}
	m := make(map[string]struct{}, len(defaults))
	for _, o := range defaults {
		m[o] = struct{}{}
	}
	return m
}()

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if _, ok := allowedOrigins[origin]; ok {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Credentials", "true")
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Provider-Key, X-OpenAI-Key, X-Anthropic-Key")
		c.Header("Access-Control-Max-Age", "86400")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

// authMiddleware enforces a bearer token when ENCOREHUB_AUTH_TOKEN is set.
// When unset (typical local dev / Tauri sidecar bound to 127.0.0.1), auth is
// disabled to keep DX simple. Any production / network-exposed deployment
// MUST set this env var.
func authMiddleware() gin.HandlerFunc {
	expected := os.Getenv("ENCOREHUB_AUTH_TOKEN")
	if expected == "" {
		return func(c *gin.Context) { c.Next() }
	}
	return func(c *gin.Context) {
		got := c.GetHeader("Authorization")
		const prefix = "Bearer "
		if !strings.HasPrefix(got, prefix) || !subtleEqual(got[len(prefix):], expected) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Next()
	}
}

// subtleEqual is a constant-time string compare to avoid token timing leaks.
func subtleEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var v byte
	for i := 0; i < len(a); i++ {
		v |= a[i] ^ b[i]
	}
	return v == 0
}

// rateLimitMiddleware caps requests per client IP. Defaults: 30 req/s with
// burst 60. Tune via ENCOREHUB_RATE_LIMIT_RPS / ENCOREHUB_RATE_LIMIT_BURST.
func rateLimitMiddleware() gin.HandlerFunc {
	rps := envFloat("ENCOREHUB_RATE_LIMIT_RPS", 30)
	burst := envInt("ENCOREHUB_RATE_LIMIT_BURST", 60)

	var (
		mu       sync.Mutex
		limiters = make(map[string]*rate.Limiter)
	)

	getLimiter := func(ip string) *rate.Limiter {
		mu.Lock()
		defer mu.Unlock()
		l, ok := limiters[ip]
		if !ok {
			l = rate.NewLimiter(rate.Limit(rps), burst)
			limiters[ip] = l
		}
		return l
	}

	return func(c *gin.Context) {
		if !getLimiter(c.ClientIP()).Allow() {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "rate limit exceeded"})
			return
		}
		c.Next()
	}
}

func envFloat(key string, def float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
			return f
		}
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil && i > 0 {
			return i
		}
	}
	return def
}

// requestIDMiddleware honours an inbound X-Request-ID, generating one if
// missing. The id is reflected into the response header, stored on the gin
// context as `request_id`, and bound onto c.Request.Context() so downstream
// http calls (engine.Client) can propagate it transparently.
func requestIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := strings.TrimSpace(c.GetHeader(requestIDHeader))
		if id == "" {
			id = newRequestID()
		}
		c.Set("request_id", id)
		c.Writer.Header().Set(requestIDHeader, id)
		c.Request = c.Request.WithContext(engine.WithRequestID(c.Request.Context(), id))
		c.Next()
	}
}

// newRequestID returns a 16-byte hex token. Falls back to a short timestamp
// if /dev/urandom is unavailable — collisions are non-fatal here.
func newRequestID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "req-" + strconv.FormatInt(int64(len(b)), 16)
	}
	return hex.EncodeToString(b[:])
}
