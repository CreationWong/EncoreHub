//! Stable C ABI around RUSTScrapling's HTML parser.

use rust_scrapling::Selector;
use serde::Serialize;
use std::{panic::AssertUnwindSafe, ptr, slice, str};

pub const RUST_SCRAPLING_ABI_VERSION: u32 = 1;

const STATUS_OK: i32 = 0;
const STATUS_INVALID_ARGUMENT: i32 = 1;
const STATUS_BUFFER_TOO_SMALL: i32 = 2;
const STATUS_FAILED: i32 = 3;

const MAX_TITLE_CHARS: usize = 500;
const MAX_CONTENT_CHARS: usize = 24_000;
const IGNORED_TAGS: &[&str] = &[
    "script", "style", "noscript", "template", "svg", "canvas", "nav", "header", "footer", "aside",
    "form", "button",
];

#[derive(Serialize)]
struct ExtractedPage {
    title: String,
    content: String,
}

#[no_mangle]
pub extern "C" fn encorehub_rust_scrapling_abi_version() -> u32 {
    RUST_SCRAPLING_ABI_VERSION
}

/// Extract readable page JSON into caller-owned memory.
///
/// Call once with a null output pointer to obtain the required byte length,
/// then call again with a buffer of at least that size.
///
/// # Safety
///
/// Input pointers must reference readable UTF-8 buffers of the supplied
/// lengths. `output_len` must be writable. A non-null `output_ptr` must point
/// to `output_capacity` writable bytes.
#[no_mangle]
pub unsafe extern "C" fn encorehub_rust_scrapling_extract_html(
    html_ptr: *const u8,
    html_len: usize,
    url_ptr: *const u8,
    url_len: usize,
    output_ptr: *mut u8,
    output_capacity: usize,
    output_len: *mut usize,
) -> i32 {
    match std::panic::catch_unwind(AssertUnwindSafe(|| {
        extract_into(
            html_ptr,
            html_len,
            url_ptr,
            url_len,
            output_ptr,
            output_capacity,
            output_len,
        )
    })) {
        Ok(status) => status,
        Err(_) => STATUS_FAILED,
    }
}

unsafe fn extract_into(
    html_ptr: *const u8,
    html_len: usize,
    url_ptr: *const u8,
    url_len: usize,
    output_ptr: *mut u8,
    output_capacity: usize,
    output_len: *mut usize,
) -> i32 {
    if html_ptr.is_null() || output_len.is_null() || (url_len > 0 && url_ptr.is_null()) {
        return STATUS_INVALID_ARGUMENT;
    }
    let Ok(html) = str::from_utf8(slice::from_raw_parts(html_ptr, html_len)) else {
        return STATUS_INVALID_ARGUMENT;
    };
    let url = if url_len == 0 {
        ""
    } else {
        let Ok(value) = str::from_utf8(slice::from_raw_parts(url_ptr, url_len)) else {
            return STATUS_INVALID_ARGUMENT;
        };
        value
    };
    let page = extract_page(html, url);
    let Ok(encoded) = serde_json::to_vec(&page) else {
        return STATUS_FAILED;
    };
    *output_len = encoded.len();
    if output_ptr.is_null() || output_capacity < encoded.len() {
        return STATUS_BUFFER_TOO_SMALL;
    }
    ptr::copy_nonoverlapping(encoded.as_ptr(), output_ptr, encoded.len());
    STATUS_OK
}

fn extract_page(html: &str, url: &str) -> ExtractedPage {
    let document = Selector::from_html_with_url(html, url);
    let title = first_text(
        &document,
        &["title::text", r#"meta[property="og:title"]::attr(content)"#],
    );

    let mut candidates = document
        .css("main, article, [role=main], .post-content, .article-content, .entry-content, #content, .content")
        .into_iter()
        .map(|node| normalize_text(node.get_all_text(" ", true, IGNORED_TAGS, None).as_str()))
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>();
    candidates.sort_by_key(|text| std::cmp::Reverse(text.chars().count()));

    let content = candidates.into_iter().next().unwrap_or_else(|| {
        let body = document
            .css("body")
            .into_iter()
            .next()
            .map(|body| normalize_text(body.get_all_text(" ", true, IGNORED_TAGS, None).as_str()))
            .unwrap_or_else(|| {
                normalize_text(
                    document
                        .get_all_text(" ", true, IGNORED_TAGS, None)
                        .as_str(),
                )
            });
        if body.is_empty() {
            first_text(
                &document,
                &[
                    "meta[name=description]::attr(content)",
                    r#"meta[property="og:description"]::attr(content)"#,
                ],
            )
        } else {
            body
        }
    });

    ExtractedPage {
        title: truncate_chars(&title, MAX_TITLE_CHARS),
        content: truncate_chars(&content, MAX_CONTENT_CHARS),
    }
}

/// Return the first non-empty text or attribute value from a selector list.
fn first_text(document: &Selector, selectors: &[&str]) -> String {
    selectors
        .iter()
        .find_map(|selector| {
            document
                .css_get(selector)
                .map(|value| normalize_text(value.as_str()))
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_default()
}

fn normalize_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_owned();
    }
    let mut truncated = value.chars().take(limit).collect::<String>();
    truncated.push_str("\n[page content truncated]");
    truncated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_content_and_discards_page_chrome() {
        let page = extract_page(
            "<html><head><title> Example </title><style>.x{}</style></head><body><nav>Menu</nav><article><h1>Heading</h1><p>Useful facts.</p><script>attack()</script></article><footer>Legal</footer></body></html>",
            "https://example.com",
        );
        assert_eq!(page.title, "Example");
        assert_eq!(page.content, "Heading Useful facts.");
    }

    #[test]
    fn extracts_metadata_from_javascript_shell_pages() {
        let page = extract_page(
            r#"<html><head><meta name="description" content="A useful page summary"><meta property="og:title" content="Dynamic page"><script>render()</script></head><body><div id="app"></div><script src="app.js"></script></body></html>"#,
            "https://example.com/dynamic",
        );
        assert_eq!(page.title, "Dynamic page");
        assert_eq!(page.content, "A useful page summary");
    }

    #[test]
    fn abi_uses_caller_owned_output_buffer() {
        let html = b"<main>Hello <b>world</b></main>";
        let mut required = 0;
        let first = unsafe {
            encorehub_rust_scrapling_extract_html(
                html.as_ptr(),
                html.len(),
                ptr::null(),
                0,
                ptr::null_mut(),
                0,
                &mut required,
            )
        };
        assert_eq!(first, STATUS_BUFFER_TOO_SMALL);
        let mut output = vec![0; required];
        let second = unsafe {
            encorehub_rust_scrapling_extract_html(
                html.as_ptr(),
                html.len(),
                ptr::null(),
                0,
                output.as_mut_ptr(),
                output.len(),
                &mut required,
            )
        };
        assert_eq!(second, STATUS_OK);
        let page: serde_json::Value = serde_json::from_slice(&output).expect("valid result JSON");
        assert_eq!(page["content"], "Hello world");
    }
}
