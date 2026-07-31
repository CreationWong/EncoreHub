package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/provider"
	"github.com/gin-gonic/gin"
)

const (
	maxEmbeddingInputs     = 2048
	maxEmbeddingInputBytes = 8 << 20
	maxEmbeddingDimensions = 3072
)

type createEmbeddingsRequest struct {
	Model          string          `json:"model"`
	Input          json.RawMessage `json:"input"`
	Dimensions     int             `json:"dimensions,omitempty"`
	EncodingFormat string          `json:"encoding_format,omitempty"`
}

// CreateEmbeddings performs a standalone utility call. It deliberately has no
// conversation identifier and never reaches chat persistence or generation.
func (h *ProviderHandler) CreateEmbeddings(c *gin.Context) {
	providerID := strings.TrimSpace(c.Param("provider"))
	profile, found := h.profile(providerID)
	if !found || !profile.Enabled {
		c.JSON(http.StatusNotFound, gin.H{"error": "provider is not available"})
		return
	}
	if profile.Protocol != provider.ProtocolOpenAI {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider does not support OpenAI-compatible embeddings"})
		return
	}

	var wire createEmbeddingsRequest
	if err := c.ShouldBindJSON(&wire); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid embedding request"})
		return
	}
	wire.Model = strings.TrimSpace(wire.Model)
	if !profileHasModel(profile, wire.Model) || profile.ModelType(wire.Model) != provider.ModelTypeEmbedding {
		c.JSON(http.StatusBadRequest, gin.H{"error": "model is not configured for embeddings"})
		return
	}
	inputs, err := normalizeEmbeddingInput(wire.Input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if wire.EncodingFormat != "" && wire.EncodingFormat != "float" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only float embedding encoding is supported"})
		return
	}
	if wire.Dimensions == 0 {
		if config, ok := profile.ModelConfig(wire.Model); ok {
			wire.Dimensions = config.Dimensions
		}
	}
	if wire.Dimensions < 0 || wire.Dimensions > maxEmbeddingDimensions {
		c.JSON(http.StatusBadRequest, gin.H{"error": "dimensions must be between 1 and 3072"})
		return
	}

	adapter, err := h.registry.Get(providerID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "provider is not available"})
		return
	}
	embedder, supported := adapter.(provider.EmbeddingAdapter)
	if !supported {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider does not support embeddings"})
		return
	}
	apiKey := c.GetHeader("X-" + providerID + "-Key")
	if apiKey == "" {
		apiKey = c.GetHeader("X-Provider-Key")
	}
	if strings.TrimSpace(apiKey) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "API key is required"})
		return
	}

	response, err := embedder.Embed(c.Request.Context(), &provider.EmbeddingRequest{
		Model:          wire.Model,
		Input:          inputs,
		Dimensions:     wire.Dimensions,
		EncodingFormat: "float",
	}, apiKey)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "embedding provider request failed"})
		return
	}
	c.JSON(http.StatusOK, response)
}

func (h *ProviderHandler) profile(id string) (provider.ProviderProfile, bool) {
	for _, profile := range h.store.Profiles() {
		if profile.ID == id {
			return profile, true
		}
	}
	return provider.ProviderProfile{}, false
}

func profileHasModel(profile provider.ProviderProfile, model string) bool {
	for _, configured := range profile.Models {
		if configured == model {
			return true
		}
	}
	return false
}

func normalizeEmbeddingInput(raw json.RawMessage) ([]string, error) {
	if len(raw) == 0 || len(raw) > maxEmbeddingInputBytes {
		return nil, embeddingInputError()
	}
	var single string
	if err := json.Unmarshal(raw, &single); err == nil {
		if strings.TrimSpace(single) == "" {
			return nil, embeddingInputError()
		}
		return []string{single}, nil
	}
	var multiple []string
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := decoder.Decode(&multiple); err != nil || len(multiple) == 0 || len(multiple) > maxEmbeddingInputs {
		return nil, embeddingInputError()
	}
	for _, input := range multiple {
		if strings.TrimSpace(input) == "" {
			return nil, embeddingInputError()
		}
	}
	return multiple, nil
}

func embeddingInputError() error {
	return &embeddingValidationError{message: "input must be a non-empty string or array of non-empty strings"}
}

type embeddingValidationError struct{ message string }

func (e *embeddingValidationError) Error() string { return e.message }
