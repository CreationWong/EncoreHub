package router

import (
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/encorehub/gateway/internal/engine"
	"github.com/encorehub/gateway/internal/handler"
	"github.com/encorehub/gateway/internal/provider"
	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// Config holds dependencies for the router.
type Config struct {
	Registry *provider.Registry
	Engine   *engine.Client
}

// Setup builds the Gin router with all middleware and routes.
func Setup(cfg Config) *gin.Engine {
	r := gin.New()

	// Middleware (order matters: CORS -> rate limit -> auth -> handlers)
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	r.Use(corsMiddleware())
	r.Use(rateLimitMiddleware())

	// Handlers
	convHandler := handler.NewConversationHandler(cfg.Engine)
	chatHandler := handler.NewChatHandler(cfg.Registry, cfg.Engine)
	providerHandler := handler.NewProviderHandler(cfg.Registry)
	searchHandler := handler.NewSearchHandler()

	// Health is unauthenticated to support container probes.
	r.GET("/api/v1/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "service": "encorehub-gateway"})
	})

	api := r.Group("/api/v1")
	api.Use(authMiddleware())
	{
		// Conversations (proxied to engine)
		conv := api.Group("/conversations")
		{
			conv.POST("", convHandler.Create)
			conv.GET("", convHandler.List)
			conv.GET("/:id", convHandler.Get)
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
			prov.GET("/:provider/models", providerHandler.ListModels)
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
