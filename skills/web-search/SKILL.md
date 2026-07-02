---
name: web-search
description: Search the web for real-time information using DuckDuckGo, Bing, or Google
version: 1.1.0
author: EncoreHub
triggers:
  - "search for"
  - "look up"
  - "find information about"
  - "what is the latest"
  - "@web"
tools:
  - name: web_search
    description: Search the web (DuckDuckGo/Bing/Google)
    parameters:
      query:
        type: string
        description: The search query
      max_results:
        type: integer
        default: 5
---

# Web Search Skill

Search the web for real-time information.

Supported search providers:
- **DuckDuckGo** — HTML web search (free, no key required; scrapes html.duckduckgo.com)
- **Bing** — Bing Web Search API v7 (requires `BING_SEARCH_API_KEY`)
- **Google** — Google Custom Search JSON API (requires `GOOGLE_SEARCH_API_KEY` + `GOOGLE_CSE_CX`)

## Usage

Toggle the web search button (🌐) in the chat input area, then select your preferred provider. When enabled, search results from the selected provider are injected into the AI's context before it generates a response.

## Example

User: "search for Rust programming language"
→ Queries the selected search provider and returns formatted results (titles, URLs, snippets).
