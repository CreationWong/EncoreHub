# 0010 - Explicit DuckDuckGo HTML search provider

* **Status**: Accepted
* **Date**: 2026-08-11
* **Decision makers**: Project lead

## Context

DuckDuckGo Instant Answer is useful for entities and direct facts but is not a
general web index. Users need a no-key option for ordinary web queries when a
SearXNG or OpenSERP endpoint is not configured.

ADR-0009 rejected an automatic HTML fallback because it could silently turn a
CAPTCHA, consent page, or generic portal into unrelated results. The requested
DuckDuckGo HTML endpoint can be added without reintroducing that behavior if it
is an explicit provider with strict result-page validation.

## Decision

Add `duckduckgo_html` as a user-selected provider backed by
`https://html.duckduckgo.com/html/`.

- It never runs as a fallback from DuckDuckGo Instant Answer.
- Engine Curl remains the only network transport and applies the public search
  provider policy, redirects, DNS checks, timeout, and response-size limit.
- Gateway parses the HTML syntax tree and reads only DuckDuckGo result title,
  link, and snippet nodes. Script and style text is not considered.
- DuckDuckGo redirect URLs are decoded from the `uddg` parameter before normal
  result validation and exact-URL deduplication.
- Provider order is preserved and the configured result limit is applied. No
  local keyword rescoring is added.
- HTTP 202 and known challenge markers are reported as requiring human
  verification. EncoreHub does not open a browser without separate explicit
  user consent.
- A successful HTML response without result or explicit no-result markup is a
  parser/provider error, not an empty successful search.

## Consequences

- Ordinary no-key web queries have broader coverage when the user explicitly
  selects DuckDuckGo HTML.
- The provider can be rate-limited or challenged more often than structured
  APIs, and callers receive an explicit error in that case.
- SearXNG and OpenSERP remain the reliable configurable choices; Instant Answer
  remains available as a separate provider.

## Related work

- [ADR-0009](0009-curl-network-access.md) defines the shared Curl and
  RUSTScrapling network boundary retained by this provider.
