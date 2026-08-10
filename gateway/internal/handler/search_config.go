package handler

import (
	"context"
	"fmt"
	"strings"

	"com.0d000721.encorehub/gateway/internal/engine"
	"com.0d000721.encorehub/gateway/internal/search"
)

const searchSettingsConfigKey = "web_search_settings"

type webSearchSettings struct {
	Enabled    bool                   `json:"enabled"`
	Provider   string                 `json:"provider"`
	MaxResults int                    `json:"max_results"`
	SearXNG    searXNGSearchSettings  `json:"searxng"`
	OpenSERP   openSERPSearchSettings `json:"openserp"`
}

type searXNGSearchSettings struct {
	Endpoint string `json:"endpoint"`
}

type openSERPSearchSettings struct {
	Endpoint string `json:"endpoint"`
	Engine   string `json:"engine"`
	Engines  string `json:"engines"`
}

func defaultWebSearchSettings() webSearchSettings {
	return webSearchSettings{Provider: "duckduckgo", MaxResults: search.DefaultMaxResults}
}

func loadWebSearchSettings(ctx context.Context, client *engine.Client) webSearchSettings {
	settings := defaultWebSearchSettings()
	if client == nil {
		return settings
	}
	var stored webSearchSettings
	if err := client.GetConfig(ctx, searchSettingsConfigKey, &stored); err != nil {
		return settings
	}
	if provider := strings.ToLower(strings.TrimSpace(stored.Provider)); provider == "duckduckgo" || provider == "searxng" || provider == "openserp" {
		settings.Provider = provider
	}
	settings.Enabled = stored.Enabled
	if stored.MaxResults >= 1 && stored.MaxResults <= search.MaxResults {
		settings.MaxResults = stored.MaxResults
	}
	settings.SearXNG.Endpoint = strings.TrimSpace(stored.SearXNG.Endpoint)
	settings.OpenSERP.Endpoint = strings.TrimSpace(stored.OpenSERP.Endpoint)
	settings.OpenSERP.Engine = strings.ToLower(strings.TrimSpace(stored.OpenSERP.Engine))
	settings.OpenSERP.Engines = strings.TrimSpace(stored.OpenSERP.Engines)
	return settings
}

func resolveWebSearchProvider(ctx context.Context, client *engine.Client, requested string) (search.Provider, webSearchSettings, error) {
	settings := loadWebSearchSettings(ctx, client)
	providerName := strings.ToLower(strings.TrimSpace(requested))
	if providerName == "" {
		providerName = settings.Provider
	}
	if client == nil {
		return nil, settings, fmt.Errorf("search provider requires the Engine Curl network service")
	}
	options := []search.ProviderOption{search.WithFetcher(client)}
	switch providerName {
	case "duckduckgo":
	case "searxng":
		if settings.SearXNG.Endpoint == "" {
			return nil, settings, fmt.Errorf("SearXNG endpoint is not configured")
		}
		options = append(options, search.WithSearXNGConfig(search.SearXNGConfig{Endpoint: settings.SearXNG.Endpoint}))
	case "openserp":
		if settings.OpenSERP.Endpoint == "" {
			return nil, settings, fmt.Errorf("OpenSERP endpoint is not configured")
		}
		options = append(options, search.WithOpenSERPConfig(search.OpenSERPConfig{
			Endpoint: settings.OpenSERP.Endpoint,
			Engine:   settings.OpenSERP.Engine,
			Engines:  settings.OpenSERP.Engines,
		}))
	default:
		return nil, settings, fmt.Errorf("unsupported search provider %q", providerName)
	}
	provider, err := search.NewProvider(providerName, options...)
	return provider, settings, err
}
