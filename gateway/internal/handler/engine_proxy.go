package handler

import (
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/encorehub/gateway/internal/engine"
	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

// EngineProxy forwards a small allowlist of GET/POST/DELETE engine routes
// transparently to the Rust engine. Used for skills/memories/knowledge —
// resources where the gateway has no policy to apply beyond auth/rate-limit.
type EngineProxy struct {
	engine *engine.Client
}

func NewEngineProxy(eng *engine.Client) *EngineProxy {
	return &EngineProxy{engine: eng}
}

// Forward proxies the current request to engineBase + suffix, preserving
// method/body/query. The suffix is built from the gateway path after the
// `/api/v1/` prefix is stripped.
func (p *EngineProxy) Forward(c *gin.Context) {
	// Translate /api/v1/<resource>... -> /api/<resource>...
	const prefix = "/api/v1/"
	gwPath := c.Request.URL.Path
	if !strings.HasPrefix(gwPath, prefix) {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "bad proxy path"})
		return
	}
	suffix := gwPath[len(prefix):]
	target := p.engine.BaseURL() + "/api/" + suffix
	if raw := c.Request.URL.RawQuery; raw != "" {
		target += "?" + raw
	}

	if _, err := url.Parse(target); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "bad target url"})
		return
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, target, c.Request.Body)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if ct := c.GetHeader("Content-Type"); ct != "" {
		req.Header.Set("Content-Type", ct)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Warn().Err(err).Str("target", target).Msg("engine proxy failed")
		c.AbortWithStatusJSON(http.StatusBadGateway, gin.H{"error": "engine unavailable"})
		return
	}
	defer resp.Body.Close()

	for k, vs := range resp.Header {
		for _, v := range vs {
			c.Writer.Header().Add(k, v)
		}
	}
	c.Writer.WriteHeader(resp.StatusCode)
	if _, err := io.Copy(c.Writer, resp.Body); err != nil {
		log.Warn().Err(err).Msg("engine proxy copy failed")
	}
}
