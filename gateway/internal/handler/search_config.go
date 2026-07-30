package handler

import (
	"context"
	"fmt"
	"os"
	"strings"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/engine"
	"com.0d000721.encorehub/gateway/internal/search"
)

const searchSettingsConfigKey = "web_search_settings"

const (
	searchSecretBing   = "system.search.bing"
	searchSecretGoogle = "system.search.google"
	searchSecretCustom = "system.search.custom"
)

type webSearchSettings struct {
	Enabled     bool                    `json:"enabled"`
	Provider    string                  `json:"provider"`
	MaxResults  int                     `json:"max_results"`
	GoogleCSEID string                  `json:"google_cse_id"`
	Custom      customWebSearchSettings `json:"custom"`
}

type customWebSearchSettings struct {
	Name           string `json:"name"`
	Endpoint       string `json:"endpoint"`
	QueryParameter string `json:"query_parameter"`
	LimitParameter string `json:"limit_parameter"`
	APIKeyHeader   string `json:"api_key_header"`
	APIKeyPrefix   string `json:"api_key_prefix"`
	ResultsPath    string `json:"results_path"`
	TitlePath      string `json:"title_path"`
	URLPath        string `json:"url_path"`
	SnippetPath    string `json:"snippet_path"`
}

func defaultWebSearchSettings() webSearchSettings {
	return webSearchSettings{
		Provider:   "duckduckgo",
		MaxResults: search.DefaultMaxResults,
		Custom: customWebSearchSettings{
			Name:           "Custom search",
			QueryParameter: "q",
			LimitParameter: "count",
			ResultsPath:    "results",
			TitlePath:      "title",
			URLPath:        "url",
			SnippetPath:    "snippet",
		},
	}
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
	if stored.Provider != "" {
		settings.Provider = strings.ToLower(strings.TrimSpace(stored.Provider))
	}
	settings.Enabled = stored.Enabled
	if stored.MaxResults >= 1 && stored.MaxResults <= search.MaxResults {
		settings.MaxResults = stored.MaxResults
	}
	settings.GoogleCSEID = strings.TrimSpace(stored.GoogleCSEID)
	mergeCustomWebSearchSettings(&settings.Custom, stored.Custom)
	return settings
}

func mergeCustomWebSearchSettings(target *customWebSearchSettings, stored customWebSearchSettings) {
	if stored.Name != "" {
		target.Name = strings.TrimSpace(stored.Name)
	}
	target.Endpoint = strings.TrimSpace(stored.Endpoint)
	for destination, value := range map[*string]string{
		&target.QueryParameter: stored.QueryParameter,
		&target.LimitParameter: stored.LimitParameter,
		&target.APIKeyHeader:   stored.APIKeyHeader,
		&target.ResultsPath:    stored.ResultsPath,
		&target.TitlePath:      stored.TitlePath,
		&target.URLPath:        stored.URLPath,
		&target.SnippetPath:    stored.SnippetPath,
	} {
		if value != "" {
			*destination = strings.TrimSpace(value)
		}
	}
	if stored.APIKeyPrefix != "" {
		target.APIKeyPrefix = stored.APIKeyPrefix
	}
}

func resolveWebSearchProvider(
	ctx context.Context,
	client *engine.Client,
	requested string,
) (search.Provider, webSearchSettings, error) {
	settings := loadWebSearchSettings(ctx, client)
	providerName := strings.ToLower(strings.TrimSpace(requested))
	if providerName == "" {
		providerName = settings.Provider
	}

	apiKey := ""
	options := make([]search.ProviderOption, 0, 1)
	switch providerName {
	case "duckduckgo":
	case "bing":
		apiKey = searchSecret(ctx, client, searchSecretBing, "BING_SEARCH_API_KEY")
	case "google":
		apiKey = searchSecret(ctx, client, searchSecretGoogle, "GOOGLE_SEARCH_API_KEY")
		cseID := settings.GoogleCSEID
		if cseID == "" {
			cseID = os.Getenv("GOOGLE_CSE_CX")
		}
		options = append(options, search.WithGoogleCSEcx(cseID))
	case "custom":
		apiKey = searchSecret(ctx, client, searchSecretCustom, "")
		options = append(options, search.WithCustomConfig(search.CustomConfig{
			Name:           settings.Custom.Name,
			Endpoint:       settings.Custom.Endpoint,
			QueryParameter: settings.Custom.QueryParameter,
			LimitParameter: settings.Custom.LimitParameter,
			APIKeyHeader:   settings.Custom.APIKeyHeader,
			APIKeyPrefix:   settings.Custom.APIKeyPrefix,
			ResultsPath:    settings.Custom.ResultsPath,
			TitlePath:      settings.Custom.TitlePath,
			URLPath:        settings.Custom.URLPath,
			SnippetPath:    settings.Custom.SnippetPath,
		}))
	default:
		return nil, settings, fmt.Errorf("unsupported search provider %q", providerName)
	}

	provider, err := search.NewProvider(providerName, apiKey, options...)
	return provider, settings, err
}

func searchSecret(ctx context.Context, client *engine.Client, secretID, environmentKey string) string {
	if client != nil {
		if key, found, err := client.GetSecret(ctx, secretID); err == nil && found {
			return key
		}
	}
	if environmentKey != "" {
		return os.Getenv(environmentKey)
	}
	return ""
}
