package provider

import "testing"

func TestResolveAPIBaseURLCompletesDomainOnlyEndpoints(t *testing.T) {
	for name, test := range map[string]struct {
		protocol string
		baseURL  string
		want     string
	}{
		"openai": {
			protocol: ProtocolOpenAI,
			baseURL:  "https://gateway.example.com",
			want:     "https://gateway.example.com/openai/v1",
		},
		"openai responses": {
			protocol: ProtocolOpenAIResponses,
			baseURL:  "https://gateway.example.com",
			want:     "https://gateway.example.com/openai/v1",
		},
		"anthropic": {
			protocol: ProtocolAnthropic,
			baseURL:  "https://gateway.example.com/",
			want:     "https://gateway.example.com/anthropic/v1",
		},
		"API prefix": {
			protocol: ProtocolAnthropic,
			baseURL:  "https://gateway.example.com/api",
			want:     "https://gateway.example.com/api/anthropic/v1",
		},
		"protocol prefix": {
			protocol: ProtocolAnthropic,
			baseURL:  "https://gateway.example.com/api/anthropic",
			want:     "https://gateway.example.com/api/anthropic/v1",
		},
		"existing v1 path": {
			protocol: ProtocolAnthropic,
			baseURL:  "https://api.anthropic.com/v1",
			want:     "https://api.anthropic.com/v1",
		},
	} {
		t.Run(name, func(t *testing.T) {
			if got := ResolveAPIBaseURL(test.protocol, test.baseURL); got != test.want {
				t.Fatalf("ResolveAPIBaseURL() = %q, want %q", got, test.want)
			}
		})
	}
}
