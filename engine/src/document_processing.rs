//! Native document parsing and Unicode-safe chunking for local ingestion.
//!
//! The module deliberately exposes byte-oriented parsing so callers do not
//! need temporary files or a language runtime. Archive expansion is bounded;
//! malformed or oversized user documents fail without partially extracted
//! output. The parser targets the lightweight formats accepted by uploads and
//! leaves higher-fidelity conversion to an installed Pandoc executable.

use quick_xml::{events::Event, Reader};
use regex::Regex;
use std::{
    io::{Cursor, Read},
    sync::OnceLock,
};
use thiserror::Error;
use zip::ZipArchive;

/// Maximum uncompressed content consumed from any single archive member.
const MAX_MEMBER_BYTES: u64 = 40 * 1024 * 1024;

/// A document rejected by the native parser.
#[derive(Debug, Error)]
pub enum DocumentError {
    /// The upload extension does not belong to the rich-text allowlist.
    #[error("unsupported rich-text extension: {0}")]
    Unsupported(String),
    /// A ZIP container or required member is malformed or missing.
    #[error("invalid document archive: {0}")]
    InvalidArchive(String),
    /// XML/HTML content could not be decoded safely.
    #[error("invalid document markup: {0}")]
    InvalidMarkup(String),
    /// A non-archive document is not valid UTF-8.
    #[error("document text is not valid UTF-8")]
    InvalidText,
}

/// Parse one supported rich-text upload entirely in Rust.
///
/// DOCX and ODT use their canonical XML member. EPUB reads bounded HTML/XHTML
/// members in archive order. HTML and RTF operate directly on UTF-8 bytes.
pub fn parse_rich_text(file_name: &str, bytes: &[u8]) -> Result<String, DocumentError> {
    let extension = file_name
        .rsplit_once('.')
        .map(|(_, suffix)| suffix.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "docx" => parse_xml_archive(bytes, "word/document.xml"),
        "odt" => parse_xml_archive(bytes, "content.xml"),
        "epub" => parse_epub(bytes),
        "html" | "htm" => parse_html(decode_utf8(bytes)?),
        "rtf" => parse_rtf(decode_utf8(bytes)?),
        _ => Err(DocumentError::Unsupported(extension)),
    }
}

/// Split text at nearby paragraph boundaries with deterministic overlap.
///
/// Sizes and returned overlap are measured in Unicode scalar values, avoiding
/// byte-index panics for CJK or emoji.
pub fn chunk_text(text: &str, chunk_size: usize, overlap: usize) -> Vec<String> {
    if text.is_empty() || chunk_size == 0 || overlap >= chunk_size {
        return vec![text.to_string()];
    }
    let characters: Vec<char> = text.chars().collect();
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < characters.len() {
        let target = (start + chunk_size).min(characters.len());
        let end = if target < characters.len() {
            paragraph_boundary(&characters, start + chunk_size / 2, target).unwrap_or(target)
        } else {
            target
        };
        let value: String = characters[start..end].iter().collect();
        let value = value.trim();
        if !value.is_empty() {
            chunks.push(value.to_string());
        }
        if end >= characters.len() {
            break;
        }
        start = end.saturating_sub(overlap).max(start + 1);
    }
    chunks
}

/// Locate the final blank-line boundary in the preferred half of a chunk.
fn paragraph_boundary(characters: &[char], lower: usize, upper: usize) -> Option<usize> {
    if upper <= lower + 1 {
        return None;
    }
    (lower + 1..upper)
        .rev()
        .find(|&index| characters[index - 1] == '\n' && characters[index] == '\n')
}

/// Extract and parse one required XML member from an Office-style archive.
fn parse_xml_archive(bytes: &[u8], member: &str) -> Result<String, DocumentError> {
    let mut archive = open_archive(bytes)?;
    let markup = read_member(&mut archive, member)?;
    parse_paragraph_xml(&markup)
}

/// Parse every textual EPUB member while enforcing a total extraction bound.
fn parse_epub(bytes: &[u8]) -> Result<String, DocumentError> {
    let mut archive = open_archive(bytes)?;
    let mut names = (0..archive.len())
        .filter_map(|index| {
            archive
                .by_index(index)
                .ok()
                .map(|file| file.name().to_string())
        })
        .filter(|name| {
            let lower = name.to_ascii_lowercase();
            lower.ends_with(".xhtml") || lower.ends_with(".html") || lower.ends_with(".htm")
        })
        .collect::<Vec<_>>();
    names.sort();
    let mut sections = Vec::new();
    let mut total = 0_u64;
    for name in names {
        let member = read_member(&mut archive, &name)?;
        total += member.len() as u64;
        if total > MAX_MEMBER_BYTES {
            return Err(DocumentError::InvalidArchive(
                "expanded EPUB is too large".into(),
            ));
        }
        let text = parse_html(decode_utf8(&member)?)?;
        if !text.is_empty() {
            sections.push(text);
        }
    }
    if sections.is_empty() {
        return Err(DocumentError::InvalidArchive(
            "EPUB contains no HTML content".into(),
        ));
    }
    Ok(sections.join("\n\n"))
}

/// Open a ZIP archive and normalize third-party errors at the module interface.
fn open_archive(bytes: &[u8]) -> Result<ZipArchive<Cursor<&[u8]>>, DocumentError> {
    ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| DocumentError::InvalidArchive(error.to_string()))
}

/// Read one archive member with a hard uncompressed-size ceiling.
fn read_member<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Result<Vec<u8>, DocumentError> {
    let file = archive
        .by_name(name)
        .map_err(|error| DocumentError::InvalidArchive(error.to_string()))?;
    let mut bytes = Vec::new();
    file.take(MAX_MEMBER_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| DocumentError::InvalidArchive(error.to_string()))?;
    if bytes.len() as u64 > MAX_MEMBER_BYTES {
        return Err(DocumentError::InvalidArchive(format!(
            "archive member {name} is too large"
        )));
    }
    Ok(bytes)
}

/// Extract paragraph and heading text using namespace-independent local names.
fn parse_paragraph_xml(markup: &[u8]) -> Result<String, DocumentError> {
    let mut reader = Reader::from_reader(Cursor::new(markup));
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut current = String::new();
    let mut paragraphs = Vec::new();
    let mut in_paragraph = false;
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(tag)) => {
                let local = tag.local_name();
                if matches!(local.as_ref(), b"p" | b"h") {
                    in_paragraph = true;
                    current.clear();
                }
            }
            Ok(Event::Text(text)) if in_paragraph => {
                let decoded = text
                    .xml_content()
                    .map_err(|error| DocumentError::InvalidMarkup(error.to_string()))?;
                let unescaped = quick_xml::escape::unescape(&decoded)
                    .map_err(|error| DocumentError::InvalidMarkup(error.to_string()))?;
                current.push_str(&unescaped);
            }
            Ok(Event::GeneralRef(reference)) if in_paragraph => {
                append_xml_reference(&mut current, &reference)?;
            }
            Ok(Event::End(tag)) if matches!(tag.local_name().as_ref(), b"p" | b"h") => {
                let value = current.trim();
                if !value.is_empty() {
                    paragraphs.push(value.to_string());
                }
                current.clear();
                in_paragraph = false;
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(DocumentError::InvalidMarkup(error.to_string())),
        }
        buffer.clear();
    }
    Ok(paragraphs.join("\n\n"))
}

/// Resolve the predefined XML entities and numeric character references.
fn append_xml_reference(
    output: &mut String,
    reference: &quick_xml::events::BytesRef<'_>,
) -> Result<(), DocumentError> {
    if let Some(character) = reference
        .resolve_char_ref()
        .map_err(|error| DocumentError::InvalidMarkup(error.to_string()))?
    {
        output.push(character);
        return Ok(());
    }
    let name = reference
        .decode()
        .map_err(|error| DocumentError::InvalidMarkup(error.to_string()))?;
    let character = match name.as_ref() {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        _ => {
            return Err(DocumentError::InvalidMarkup(format!(
                "unknown XML entity: {name}"
            )))
        }
    };
    output.push(character);
    Ok(())
}

/// Strip HTML markup while retaining readable block boundaries and entities.
fn parse_html(markup: &str) -> Result<String, DocumentError> {
    static BLOCKS: OnceLock<Regex> = OnceLock::new();
    static TAGS: OnceLock<Regex> = OnceLock::new();
    let blocks = BLOCKS.get_or_init(|| {
        Regex::new(r"(?is)</?(?:p|div|br|li|h[1-6])(?:\s[^>]*)?>").expect("valid block regex")
    });
    let tags = TAGS.get_or_init(|| Regex::new(r"(?is)<[^>]+>").expect("valid tag regex"));
    let with_breaks = blocks.replace_all(markup, "\n");
    let without_tags = tags.replace_all(&with_breaks, "");
    let decoded = decode_html_entities(&without_tags)?;
    Ok(collapse_blank_lines(decoded.trim()))
}

/// Remove RTF control words using the same lightweight fallback semantics.
fn parse_rtf(markup: &str) -> Result<String, DocumentError> {
    static HEX: OnceLock<Regex> = OnceLock::new();
    static CONTROL: OnceLock<Regex> = OnceLock::new();
    let hex = HEX.get_or_init(|| Regex::new(r"\\'[0-9a-fA-F]{2}").expect("valid RTF regex"));
    let control =
        CONTROL.get_or_init(|| Regex::new(r"\\[a-zA-Z]+-?\d* ?").expect("valid RTF regex"));
    let without_hex = hex.replace_all(markup, "");
    let without_control = control.replace_all(&without_hex, "");
    Ok(without_control.replace(['{', '}'], "").trim().to_string())
}

/// Decode XML entities plus the common HTML entity needed by documents.
fn decode_html_entities(text: &str) -> Result<String, DocumentError> {
    let normalized = text.replace("&nbsp;", "&#160;");
    quick_xml::escape::unescape(&normalized)
        .map(|value| value.into_owned())
        .map_err(|error| DocumentError::InvalidMarkup(error.to_string()))
}

/// Collapse excessive blank lines without modifying ordinary spaces.
fn collapse_blank_lines(text: &str) -> String {
    static BLANKS: OnceLock<Regex> = OnceLock::new();
    BLANKS
        .get_or_init(|| Regex::new(r"\n{3,}").expect("valid blank-line regex"))
        .replace_all(text, "\n\n")
        .into_owned()
}

/// Require UTF-8 for direct text formats so replacement characters are visible errors.
fn decode_utf8(bytes: &[u8]) -> Result<&str, DocumentError> {
    std::str::from_utf8(bytes).map_err(|_| DocumentError::InvalidText)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::{write::FileOptions, ZipWriter};

    /// Build a minimal archive fixture without checking binary files into Git.
    fn archive(member: &str, content: &str) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer.start_file(member, FileOptions::default()).unwrap();
        writer.write_all(content.as_bytes()).unwrap();
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn extracts_docx_paragraphs_and_entities() {
        let bytes = archive(
            "word/document.xml",
            r#"<w:document xmlns:w="urn:w"><w:p><w:r><w:t>Hello &amp; Rust</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:document>"#,
        );
        assert_eq!(
            parse_rich_text("notes.docx", &bytes).unwrap(),
            "Hello & Rust\n\n第二段"
        );
    }

    #[test]
    fn extracts_html_blocks_and_common_entities() {
        let text = parse_rich_text(
            "notes.html",
            b"<h1>Title</h1><p>one&nbsp;&amp; two</p><div>tail</div>",
        )
        .unwrap();
        assert_eq!(text, "Title\n\none\u{a0}& two\n\ntail");
    }

    #[test]
    fn chunking_is_unicode_safe_and_preserves_overlap() {
        let text = "知识向量🙂".repeat(60);
        let chunks = chunk_text(&text, 100, 20);
        assert!(chunks.len() > 1);
        let first: Vec<char> = chunks[0].chars().collect();
        let second: Vec<char> = chunks[1].chars().collect();
        assert_eq!(&first[first.len() - 20..], &second[..20]);
    }

    #[test]
    fn malformed_archive_is_reported() {
        assert!(matches!(
            parse_rich_text("notes.docx", b"not a zip"),
            Err(DocumentError::InvalidArchive(_))
        ));
    }
}
