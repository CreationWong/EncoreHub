package router

import (
	"github.com/encorehub/gateway/internal/engine"
	"github.com/encorehub/gateway/internal/handler"
	"github.com/encorehub/gateway/internal/provider"
	"github.com/gin-gonic/gin"
)

// Config holds dependencies for the router.
type Config struct {
	Registry *provider.Registry
	Engine   *engine.Client
}

// Setup builds the Gin router with all middleware and routes.
func Setup(cfg Config) *gin.Engine {
	r := gin.New()

	// Middleware
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	r.Use(corsMiddleware())

	// Handlers
	convHandler := handler.NewConversationHandler(cfg.Engine)
	chatHandler := handler.NewChatHandler(cfg.Registry, cfg.Engine)
	providerHandler := handler.NewProviderHandler(cfg.Registry)

	api := r.Group("/api/v1")
	{
		// Health
		api.GET("/health", func(c *gin.Context) {
			c.JSON(200, gin.H{"status": "ok", "service": "encorehub-gateway"})
		})

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

		// Providers
		prov := api.Group("/providers")
		{
			prov.GET("", providerHandler.ListProviders)
			prov.GET("/:provider/models", providerHandler.ListModels)
		}
	}

	return r
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Provider-Key, X-OpenAI-Key, X-Anthropic-Key")
		c.Header("Access-Control-Max-Age", "86400")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}
