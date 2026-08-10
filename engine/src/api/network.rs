//! Bounded public HTTP retrieval through the Engine Runtime's Curl backend.
//!
//! Gateway search providers and model-invoked public page reads share this
//! endpoint. The Engine owns redirects, DNS resolution, SSRF filtering, and
//! response limits so every caller receives the same network policy.

use crate::api::ErrorResponse;
use axum::{http::StatusCode, Json};
use curl::easy::{Easy2, Handler, List, WriteError};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs},
    time::{Duration, Instant},
};
use url::{Host, Url};

const DEFAULT_MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_ALLOWED_BYTES: usize = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS: u64 = 10_000;
const MAX_TIMEOUT_MS: u64 = 30_000;
const MAX_REDIRECTS: usize = 5;
type ApiError = (StatusCode, Json<ErrorResponse>);

/// Distinguishes credentialed search-provider traffic from public page reads.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum FetchPurpose {
    #[default]
    PublicPage,
    SearchProvider,
    ConfiguredSearchProvider,
}

/// Internal request accepted only after Engine bearer authentication.
#[derive(Debug, Deserialize)]
pub struct FetchRequest {
    url: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    #[serde(default)]
    max_bytes: Option<usize>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    purpose: FetchPurpose,
    #[serde(default)]
    extract: bool,
}

/// Bounded response returned to the trusted Gateway.
#[derive(Debug, Serialize)]
pub struct FetchResponse {
    status: u32,
    final_url: String,
    content_type: String,
    body: String,
    backend: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    extracted_text: Option<String>,
}

/// Curl callbacks retain only headers required for redirects and body typing.
struct ResponseCollector {
    body: Vec<u8>,
    content_type: String,
    location: String,
    max_bytes: usize,
    limit_exceeded: bool,
}

impl ResponseCollector {
    /// Allocate a response buffer with a hard post-decompression byte limit.
    fn new(max_bytes: usize) -> Self {
        Self {
            body: Vec::new(),
            content_type: String::new(),
            location: String::new(),
            max_bytes,
            limit_exceeded: false,
        }
    }
}

impl Handler for ResponseCollector {
    /// Abort the transfer as soon as the decoded body exceeds its budget.
    fn write(&mut self, data: &[u8]) -> Result<usize, WriteError> {
        if self.body.len().saturating_add(data.len()) > self.max_bytes {
            self.limit_exceeded = true;
            // A short write aborts Curl immediately; pausing would require an
            // explicit unpause and could leave the blocking worker suspended.
            return Ok(0);
        }
        self.body.extend_from_slice(data);
        Ok(data.len())
    }

    /// Capture only non-sensitive response metadata used by the fetch policy.
    fn header(&mut self, data: &[u8]) -> bool {
        let Ok(line) = std::str::from_utf8(data) else {
            return true;
        };
        let Some((name, value)) = line.split_once(':') else {
            return true;
        };
        match name.trim().to_ascii_lowercase().as_str() {
            "content-type" => self.content_type = value.trim().to_owned(),
            "location" => self.location = value.trim().to_owned(),
            _ => {}
        }
        true
    }
}

/// Fetch one public resource with Curl after applying the shared network policy.
pub async fn fetch(Json(request): Json<FetchRequest>) -> Result<Json<FetchResponse>, ApiError> {
    validate_headers(request.purpose, &request.headers).map_err(policy_error)?;
    let max_bytes = request
        .max_bytes
        .unwrap_or(DEFAULT_MAX_BYTES)
        .clamp(1, MAX_ALLOWED_BYTES);
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(1, MAX_TIMEOUT_MS);

    tokio::task::spawn_blocking(move || fetch_blocking(request, max_bytes, timeout_ms))
        .await
        .map_err(|_| upstream_error("network worker stopped unexpectedly"))?
        .map(Json)
        .map_err(map_fetch_error)
}

/// Perform redirects explicitly so every destination is resolved and checked.
fn fetch_blocking(
    request: FetchRequest,
    max_bytes: usize,
    timeout_ms: u64,
) -> Result<FetchResponse, FetchFailure> {
    let mut current = parse_public_url(&request.url)?;
    let purpose = request.purpose;
    let extract = request.extract;
    let mut headers = request.headers;
    let total_timeout = Duration::from_millis(timeout_ms);
    let started = Instant::now();
    for redirect_count in 0..=MAX_REDIRECTS {
        let resolved = resolve_public_destination(&current, purpose)?;
        let remaining = total_timeout
            .checked_sub(started.elapsed())
            .filter(|duration| !duration.is_zero())
            .ok_or(FetchFailure::Upstream("network request timed out"))?;
        let response = perform_curl_request(&current, &resolved, &headers, max_bytes, remaining)?;
        if !is_redirect(response.status) {
            let (title, extracted_text) = if extract
                && response
                    .content_type
                    .to_ascii_lowercase()
                    .starts_with("text/html")
            {
                let extracted = crate::scrapling::extract_html(
                    &String::from_utf8_lossy(&response.body),
                    current.as_str(),
                )
                .map_err(|_| FetchFailure::Upstream("RUSTScrapling extraction failed"))?;
                (Some(extracted.title), Some(extracted.content))
            } else {
                (None, None)
            };
            return Ok(FetchResponse {
                status: response.status,
                final_url: current.to_string(),
                content_type: response.content_type,
                body: String::from_utf8_lossy(&response.body).into_owned(),
                backend: "curl",
                title,
                extracted_text,
            });
        }
        if redirect_count == MAX_REDIRECTS {
            return Err(FetchFailure::Policy("redirect limit exceeded"));
        }
        if response.location.is_empty() {
            return Err(FetchFailure::Upstream("redirect response omitted Location"));
        }
        let next = current
            .join(&response.location)
            .map_err(|_| FetchFailure::Policy("redirect URL is invalid"))?;
        let next = parse_public_url(next.as_str())?;
        if !same_origin(&current, &next) {
            // Provider credentials never cross an origin boundary on redirect.
            headers.clear();
        }
        current = next;
    }
    Err(FetchFailure::Policy("redirect limit exceeded"))
}

/// Result of one non-following Curl request.
struct CurlResponse {
    status: u32,
    content_type: String,
    location: String,
    body: Vec<u8>,
}

/// Execute one GET while pinning Curl to the addresses approved by DNS policy.
fn perform_curl_request(
    url: &Url,
    resolved: &[IpAddr],
    headers: &BTreeMap<String, String>,
    max_bytes: usize,
    timeout: Duration,
) -> Result<CurlResponse, FetchFailure> {
    let mut easy = Easy2::new(ResponseCollector::new(max_bytes));
    easy.url(url.as_str()).map_err(curl_failure)?;
    easy.get(true).map_err(curl_failure)?;
    easy.follow_location(false).map_err(curl_failure)?;
    easy.timeout(timeout).map_err(curl_failure)?;
    // Search APIs can take longer than five seconds to establish a connection
    // on proxy-routed networks. The caller already supplies a bounded total
    // timeout, so the connect phase may use the same remaining budget.
    easy.connect_timeout(timeout).map_err(curl_failure)?;
    easy.useragent("EncoreHub/0.1").map_err(curl_failure)?;
    easy.accept_encoding("").map_err(curl_failure)?;

    if let Host::Domain(host) = url
        .host()
        .ok_or(FetchFailure::Policy("URL host is required"))?
    {
        let port = url
            .port_or_known_default()
            .ok_or(FetchFailure::Policy("URL port is invalid"))?;
        let mut entries = List::new();
        for address in resolved {
            let address = match address {
                IpAddr::V4(value) => value.to_string(),
                IpAddr::V6(value) => format!("[{value}]"),
            };
            entries
                .append(&format!("{host}:{port}:{address}"))
                .map_err(curl_failure)?;
        }
        easy.resolve(entries).map_err(curl_failure)?;
    }

    if !headers.is_empty() {
        let mut list = List::new();
        for (name, value) in headers {
            list.append(&format!("{name}: {value}"))
                .map_err(curl_failure)?;
        }
        easy.http_headers(list).map_err(curl_failure)?;
    }

    let transfer_result = easy.perform();
    if easy.get_ref().limit_exceeded {
        return Err(FetchFailure::TooLarge);
    }
    transfer_result.map_err(curl_failure)?;
    let status = easy.response_code().map_err(curl_failure)?;
    let collector = easy.get_ref();
    Ok(CurlResponse {
        status,
        content_type: collector.content_type.clone(),
        location: collector.location.clone(),
        body: collector.body.clone(),
    })
}

/// Parse an absolute HTTP(S) URL without embedded user credentials.
fn parse_public_url(raw: &str) -> Result<Url, FetchFailure> {
    let url = Url::parse(raw.trim()).map_err(|_| FetchFailure::Policy("URL is invalid"))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(FetchFailure::Policy("only HTTP and HTTPS URLs are allowed"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(FetchFailure::Policy("URL credentials are not allowed"));
    }
    if url.host().is_none() {
        return Err(FetchFailure::Policy("URL host is required"));
    }
    Ok(url)
}

/// Resolve a host and reject destinations containing any non-public address.
fn resolve_public_destination(
    url: &Url,
    purpose: FetchPurpose,
) -> Result<Vec<IpAddr>, FetchFailure> {
    let port = url
        .port_or_known_default()
        .ok_or(FetchFailure::Policy("URL port is invalid"))?;
    let (addresses, resolved_domain) = match url
        .host()
        .ok_or(FetchFailure::Policy("URL host is required"))?
    {
        Host::Ipv4(address) => (vec![IpAddr::V4(address)], false),
        Host::Ipv6(address) => (vec![IpAddr::V6(address)], false),
        Host::Domain(host) => (
            (host, port)
                .to_socket_addrs()
                .map_err(|_| FetchFailure::Upstream("host resolution failed"))?
                .map(|socket| socket.ip())
                .collect::<Vec<_>>(),
            true,
        ),
    };
    if addresses.is_empty() {
        return Err(FetchFailure::Upstream(
            "host resolution returned no addresses",
        ));
    }
    if purpose != FetchPurpose::ConfiguredSearchProvider {
        let allow_proxy_fake_ip = permits_proxy_fake_ip(url, purpose, resolved_domain);
        validate_destination_addresses(allow_proxy_fake_ip, &addresses)?;
    }
    let mut unique = addresses;
    unique.sort_unstable();
    unique.dedup();
    Ok(unique)
}

/// Permit proxy synthetic DNS only when the URL used a domain name. Literal
/// private, local, and fake-IP URLs remain blocked before Curl is invoked.
fn permits_proxy_fake_ip(_url: &Url, _purpose: FetchPurpose, resolved_domain: bool) -> bool {
    resolved_domain
}

/// Recognize proxy synthetic addresses after the URL has independently been
/// constrained to a domain name. Clash/Mihomo fake-IP mode commonly maps
/// public domains into these ranges before transparently intercepting Curl.
fn validate_destination_addresses(
    allow_proxy_fake_ip: bool,
    addresses: &[IpAddr],
) -> Result<(), FetchFailure> {
    if addresses.iter().all(|address| {
        is_public_ip(*address) || (allow_proxy_fake_ip && is_proxy_fake_ip(*address))
    }) {
        return Ok(());
    }
    Err(FetchFailure::Policy("destination address is not public"))
}

/// Recognize the synthetic DNS pools used by common transparent proxies.
fn is_proxy_fake_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(value) => {
            let [a, b, _, _] = value.octets();
            a == 198 && (b == 18 || b == 19)
        }
        IpAddr::V6(value) => {
            let segments = value.segments();
            segments[0] == 0xfdfe && segments[1] == 0xdcba && segments[2] == 0x9876
        }
    }
}

/// Apply a conservative routability policy to IPv4 and IPv6 destinations.
fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(value) => is_public_ipv4(value),
        IpAddr::V6(value) => is_public_ipv6(value),
    }
}

/// Reject private, local, documentation, benchmark, multicast, and reserved IPv4.
fn is_public_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    !(a == 0
        || a == 10
        || a == 127
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 168)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224)
}

/// Accept global-unicast IPv6 while excluding documentation and mapped locals.
fn is_public_ipv6(address: Ipv6Addr) -> bool {
    if let Some(mapped) = address.to_ipv4_mapped() {
        return is_public_ipv4(mapped);
    }
    let segments = address.segments();
    (segments[0] & 0xe000) == 0x2000 && !(segments[0] == 0x2001 && segments[1] == 0x0db8)
}

/// Validate header syntax and keep public reads credential-free.
fn validate_headers(
    purpose: FetchPurpose,
    headers: &BTreeMap<String, String>,
) -> Result<(), &'static str> {
    if purpose == FetchPurpose::PublicPage && !headers.is_empty() {
        return Err("public page requests cannot include custom headers");
    }
    if headers.len() > 16 {
        return Err("too many request headers");
    }
    for (name, value) in headers {
        if name.is_empty()
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            || value.contains(['\r', '\n'])
        {
            return Err("request header is invalid");
        }
        if matches!(
            name.to_ascii_lowercase().as_str(),
            "host" | "cookie" | "proxy-authorization"
        ) {
            return Err("request header is not allowed");
        }
    }
    Ok(())
}

/// Compare redirect origins before deciding whether headers may be retained.
fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

/// Return whether a status code requires an explicitly validated next hop.
fn is_redirect(status: u32) -> bool {
    matches!(status, 301 | 302 | 303 | 307 | 308)
}

/// Internal failure categories map to stable HTTP semantics without URLs or keys.
enum FetchFailure {
    Policy(&'static str),
    TooLarge,
    Upstream(&'static str),
}

/// Convert Curl codes to stable, URL-free diagnostics. The raw Curl message is
/// intentionally hidden because provider credentials may be present in URLs.
fn curl_failure(error: curl::Error) -> FetchFailure {
    let message = if error.is_operation_timedout() {
        "network request timed out"
    } else if error.is_couldnt_resolve_host() || error.is_couldnt_resolve_proxy() {
        "host resolution failed"
    } else if error.is_couldnt_connect()
        || error.is_send_error()
        || error.is_recv_error()
        || error.is_got_nothing()
    {
        "network connection failed"
    } else if error.is_ssl_connect_error()
        || error.is_peer_failed_verification()
        || error.is_ssl_certproblem()
        || error.is_ssl_cacert()
        || error.is_ssl_cacert_badfile()
        || error.is_ssl_cipher()
        || error.is_ssl_issuer_error()
    {
        "TLS connection failed"
    } else {
        "network request failed"
    };
    FetchFailure::Upstream(message)
}

/// Convert fetch failures into bounded Engine responses.
fn map_fetch_error(error: FetchFailure) -> ApiError {
    match error {
        FetchFailure::Policy(message) => policy_error(message),
        FetchFailure::TooLarge => (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(ErrorResponse {
                error: "network response exceeds size limit".to_owned(),
            }),
        ),
        FetchFailure::Upstream(message) => upstream_error(message),
    }
}

/// Return a caller-correctable policy error.
fn policy_error(message: &'static str) -> ApiError {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            error: message.to_owned(),
        }),
    )
}

/// Return an external network failure without leaking the requested URL.
fn upstream_error(message: &'static str) -> ApiError {
    (
        StatusCode::BAD_GATEWAY,
        Json(ErrorResponse {
            error: message.to_owned(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Local, private, and documentation ranges must never reach Curl.
    #[test]
    fn blocks_non_public_addresses() {
        for address in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.1.1",
            "192.168.1.1",
            "192.0.2.1",
            "::1",
            "fe80::1",
            "fc00::1",
            "2001:db8::1",
        ] {
            let parsed = address.parse::<IpAddr>().expect("test IP must parse");
            assert!(!is_public_ip(parsed), "{address} should be blocked");
        }
        assert!(is_public_ip("1.1.1.1".parse().expect("public IPv4")));
        assert!(is_public_ip(
            "2606:4700:4700::1111".parse().expect("public IPv6")
        ));
    }

    /// Proxy fake-IP DNS must remain usable for domains without making the
    /// synthetic address ranges valid as literal URL destinations.
    #[test]
    fn permits_proxy_fake_ips_for_domain_requests_but_not_literal_addresses() {
        let addresses = [
            "198.18.0.79".parse().expect("proxy fake IPv4"),
            "fdfe:dcba:9876::35".parse().expect("proxy fake IPv6"),
        ];
        assert!(validate_destination_addresses(true, &addresses).is_ok());
        assert!(validate_destination_addresses(false, &addresses).is_err());
        let bing = Url::parse("https://www.bing.com/search").expect("Bing URL");
        let custom = Url::parse("https://search.example.com/").expect("custom URL");
        assert!(permits_proxy_fake_ip(
            &bing,
            FetchPurpose::SearchProvider,
            true,
        ));
        assert!(permits_proxy_fake_ip(&bing, FetchPurpose::PublicPage, true,));
        assert!(permits_proxy_fake_ip(
            &custom,
            FetchPurpose::SearchProvider,
            true,
        ));
        assert!(!permits_proxy_fake_ip(
            &bing,
            FetchPurpose::PublicPage,
            false,
        ));
        assert!(validate_destination_addresses(
            true,
            &["127.0.0.1".parse().expect("loopback IPv4")],
        )
        .is_err());
    }

    /// Public tool calls cannot smuggle cookies or authorization headers.
    #[test]
    fn public_reads_reject_headers() {
        let headers = BTreeMap::from([("Authorization".to_owned(), "secret".to_owned())]);
        assert!(validate_headers(FetchPurpose::PublicPage, &headers).is_err());
        assert!(validate_headers(FetchPurpose::SearchProvider, &headers).is_ok());
        assert!(validate_headers(FetchPurpose::ConfiguredSearchProvider, &headers).is_ok());
    }

    /// Unsupported protocols and embedded credentials are rejected before DNS.
    #[test]
    fn validates_public_url_shape() {
        assert!(parse_public_url("file:///etc/passwd").is_err());
        assert!(parse_public_url("https://user:password@example.com").is_err());
        assert!(parse_public_url("https://example.com/path").is_ok());
    }

    #[test]
    fn configured_search_provider_is_the_only_private_network_exception() {
        let local = Url::parse("http://127.0.0.1:8080/search").expect("local URL");
        assert!(resolve_public_destination(&local, FetchPurpose::PublicPage).is_err());
        assert!(resolve_public_destination(&local, FetchPurpose::SearchProvider).is_err());
        assert!(resolve_public_destination(&local, FetchPurpose::ConfiguredSearchProvider).is_ok());
    }

    /// Curl details stay private while common failures remain actionable.
    #[test]
    fn maps_curl_failures_to_sanitized_categories() {
        let cases = [
            (curl::Error::new(28), "network request timed out"),
            (curl::Error::new(6), "host resolution failed"),
            (curl::Error::new(7), "network connection failed"),
            (curl::Error::new(35), "TLS connection failed"),
            (curl::Error::new(2), "network request failed"),
        ];
        for (error, expected) in cases {
            match curl_failure(error) {
                FetchFailure::Upstream(message) => assert_eq!(message, expected),
                _ => panic!("Curl errors must remain upstream failures"),
            }
        }
    }
}
