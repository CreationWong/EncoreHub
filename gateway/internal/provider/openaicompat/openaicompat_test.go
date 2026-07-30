package openaicompat

import (
	"context"
	"testing"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/provider"
)

func TestNew_IDAndModelsFromProfile(t *testing.T) {
	a := New(provider.ProviderProfile{
		ID:      "myprovider",
		BaseURL: "https://api.example.com/v1",
		Models:  []string{"m1", "m2"},
	})
	if a.ID() != "myprovider" {
		t.Fatalf("id = %q", a.ID())
	}
	models, err := a.ListModels(context.Background(), "")
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if len(models) != 2 || models[0].ID != "m1" || models[1].Provider != "myprovider" {
		t.Fatalf("models = %#v", models)
	}
}

func TestClient_OverridesBaseURLWhenSet(t *testing.T) {
	a := New(provider.ProviderProfile{ID: "x", BaseURL: "https://custom.local/v1"})
	if got := a.config("key").BaseURL; got != "https://custom.local/v1" {
		t.Fatalf("base url = %q", got)
	}
}

func TestClient_FallsBackToSDKDefaultWhenEmpty(t *testing.T) {
	a := New(provider.ProviderProfile{ID: "openai", BaseURL: ""})
	// go-openai's default config points at the official API; we just assert we
	// didn't blank it out.
	if got := a.config("key").BaseURL; got == "" {
		t.Fatal("expected SDK default base url, got empty")
	}
}

func TestToMessages_PrependsSystemPrompt(t *testing.T) {
	msgs := toMessages(&provider.ChatRequest{
		SystemPrompt: "be brief",
		Messages: []provider.Message{
			{Role: "user", Content: "hi"},
		},
	})
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(msgs))
	}
	if msgs[0].Role != "system" || msgs[0].Content != "be brief" {
		t.Fatalf("system message = %#v", msgs[0])
	}
	if msgs[1].Role != "user" {
		t.Fatalf("user message = %#v", msgs[1])
	}
}

func TestToMessages_NoSystemPrompt(t *testing.T) {
	msgs := toMessages(&provider.ChatRequest{
		Messages: []provider.Message{{Role: "user", Content: "hi"}},
	})
	if len(msgs) != 1 || msgs[0].Role != "user" {
		t.Fatalf("messages = %#v", msgs)
	}
}

func TestExtraBodyForRequest_DisablesDeepSeekThinkingWithoutChangingModel(t *testing.T) {
	a := New(provider.ProviderProfile{ID: "deepseek", BaseURL: "https://api.deepseek.com/v1"})
	req := &provider.ChatRequest{Model: "deepseek-v4-flash", DisableReasoning: true}

	cr := a.buildRequest(req)
	if cr.Model != "deepseek-v4-flash" {
		t.Fatalf("model changed to %q", cr.Model)
	}

	extra := a.extraBodyForRequest(req)
	thinking, ok := extra["thinking"].(map[string]string)
	if !ok {
		t.Fatalf("thinking extra missing: %#v", extra)
	}
	if thinking["type"] != "disabled" {
		t.Fatalf("thinking.type = %q", thinking["type"])
	}
}

func TestExtraBodyForRequest_DoesNotAffectOtherProviders(t *testing.T) {
	a := New(provider.ProviderProfile{ID: "openai"})
	extra := a.extraBodyForRequest(&provider.ChatRequest{Model: "gpt-4o", DisableReasoning: true})
	if extra != nil {
		t.Fatalf("unexpected extra body: %#v", extra)
	}
}

func TestExtraBodyForRequest_MatchesCustomDeepSeekProvider(t *testing.T) {
	a := New(provider.ProviderProfile{ID: "custom-openai", BaseURL: "https://example.local/v1"})
	extra := a.extraBodyForRequest(&provider.ChatRequest{Model: "vendor/deepseek-v4-flash", DisableReasoning: true})
	if extra == nil {
		t.Fatal("expected DeepSeek V4 thinking switch for custom provider model")
	}
}
