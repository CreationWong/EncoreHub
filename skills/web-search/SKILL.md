---
name: web-search
description: Search the web for real-time information using DuckDuckGo
version: 1.0.0
author: EncoreHub
triggers:
  - "search for"
  - "look up"
  - "find information about"
  - "what is the latest"
  - "@web"
tools:
  - name: web_search
    description: Search the web using DuckDuckGo
    parameters:
      query:
        type: string
        description: The search query
      max_results:
        type: integer
        default: 5
---

# Web Search Skill

Search the web for real-time information. Uses DuckDuckGo's Instant Answer API (free, no key required).

## Usage

When the user asks to search for something, this skill queries DuckDuckGo and returns formatted results. Results include titles, URLs, and snippets.

## Example

User: "search for Rust programming language"
→ Returns Wikipedia abstract and related topics about Rust.
