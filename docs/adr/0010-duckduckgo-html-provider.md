# 0010 - Combined DuckDuckGo search provider

* **Status**: Accepted
* **Date**: 2026-08-11
* **Decision makers**: Project lead

## Context

DuckDuckGo Instant Answer is useful for entities and direct facts but is not a
general web index. Users need a no-key option for ordinary web queries when a
SearXNG or OpenSERP endpoint is not configured.

ADR-0009 rejected an automatic HTML fallback because it could silently turn a
CAPTCHA, consent page, or generic portal into unrelated results. HTML results
can still be combined safely with Instant Answer when both sources are explicit
parts of one provider and retain separate result semantics.

## Decision

The single `duckduckgo` provider concurrently requests
`https://html.duckduckgo.com/html/` and the Instant Answer API.

- HTML supplies the primary web results and honors the configured result count.
- Instant Answer supplies at most three additional `featured_answer` results.
- Results are formatted in separate featured-answer and web-result sections.
- Failure of one source preserves results from the other and adds a bounded
  provider warning. The search fails only when no source returns useful data.
- Stored `duckduckgo_html` settings migrate to `duckduckgo`; the former is not
  accepted as a public provider id or shown as a separate UI option.
- Engine Curl remains the only network transport and applies the public search
  provider policy, redirects, DNS checks, timeout, and response-size limit.
- Gateway parses the HTML syntax tree and reads only DuckDuckGo result title,
  link, and snippet nodes. Script and style text is not considered.
- DuckDuckGo redirect URLs are decoded from the `uddg` parameter before normal
  result validation and exact-URL deduplication.
- Provider order is preserved within each section. No local keyword rescoring
  is added.
- HTTP 202 and known challenge markers are reported as requiring human
  verification. EncoreHub does not open a browser without separate explicit
  user consent.
- A successful HTML response without result or explicit no-result markup is a
  parser/provider error, not an empty successful search.

## Consequences

- Ordinary no-key web queries receive both web results and any relevant
  featured summary without exposing two near-identical settings.
- The HTML source can be rate-limited or challenged; Instant Answer results can
  still be returned with a warning in that case.
- SearXNG and OpenSERP remain the reliable configurable choices.

## Related work

- [ADR-0009](0009-curl-network-access.md) defines the shared Curl and
  RUSTScrapling network boundary retained by this provider.
