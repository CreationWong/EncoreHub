//! Dynamic loader for the separately packaged RUSTScrapling parser module.

use libloading::Library;
use serde::Deserialize;
use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};

const ABI_VERSION: u32 = 1;
const STATUS_OK: i32 = 0;
const STATUS_BUFFER_TOO_SMALL: i32 = 2;

type AbiVersionFn = unsafe extern "C" fn() -> u32;
type ExtractFn =
    unsafe extern "C" fn(*const u8, usize, *const u8, usize, *mut u8, usize, *mut usize) -> i32;

static CONFIGURED_PATH: OnceLock<PathBuf> = OnceLock::new();
static LIBRARY: OnceLock<Result<ScraplingLibrary, String>> = OnceLock::new();

#[derive(Debug, Deserialize)]
pub struct ExtractedPage {
    pub title: String,
    pub content: String,
}

struct ScraplingLibrary {
    _library: Library,
    extract: ExtractFn,
}

pub fn configure_library_path(path: impl AsRef<Path>) -> Result<(), String> {
    let path = path.as_ref();
    if !path.is_file() {
        return Err(format!(
            "RUSTScrapling library was not found at {}",
            path.display()
        ));
    }
    configure_path_once(&CONFIGURED_PATH, path.to_path_buf())
}

/// Keep process-wide dynamic-library identity stable while permitting a
/// stopped desktop runtime to start again with the same packaged module.
fn configure_path_once(slot: &OnceLock<PathBuf>, path: PathBuf) -> Result<(), String> {
    if let Some(configured) = slot.get() {
        return if configured == &path {
            Ok(())
        } else {
            Err(format!(
                "RUSTScrapling library path is already configured as {}",
                configured.display()
            ))
        };
    }
    if slot.set(path.clone()).is_ok() {
        return Ok(());
    }
    if slot.get() == Some(&path) {
        Ok(())
    } else {
        Err("RUSTScrapling library path was configured concurrently".to_owned())
    }
}

pub fn extract_html(html: &str, url: &str) -> Result<ExtractedPage, String> {
    let library = LIBRARY
        .get_or_init(load_library)
        .as_ref()
        .map_err(Clone::clone)?;
    let mut required = 0usize;
    let status = unsafe {
        (library.extract)(
            html.as_ptr(),
            html.len(),
            url.as_ptr(),
            url.len(),
            std::ptr::null_mut(),
            0,
            &mut required,
        )
    };
    if status != STATUS_BUFFER_TOO_SMALL || required == 0 || required > 256 * 1024 {
        return Err("RUSTScrapling rejected the page extraction request".to_owned());
    }
    let mut output = vec![0u8; required];
    let status = unsafe {
        (library.extract)(
            html.as_ptr(),
            html.len(),
            url.as_ptr(),
            url.len(),
            output.as_mut_ptr(),
            output.len(),
            &mut required,
        )
    };
    if status != STATUS_OK || required > output.len() {
        return Err("RUSTScrapling failed to extract readable content".to_owned());
    }
    serde_json::from_slice(&output[..required])
        .map_err(|_| "RUSTScrapling returned an invalid response".to_owned())
}

fn load_library() -> Result<ScraplingLibrary, String> {
    let candidates = library_candidates();
    let path = candidates
        .iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            format!(
                "RUSTScrapling library was not found; checked {}",
                candidates
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })?;
    unsafe {
        let library = load_dynamic_library(path)
            .map_err(|error| format!("failed to load RUSTScrapling: {error}"))?;
        let abi: AbiVersionFn = *library
            .get(b"encorehub_rust_scrapling_abi_version\0")
            .map_err(|_| "RUSTScrapling ABI symbol is missing".to_owned())?;
        if abi() != ABI_VERSION {
            return Err("RUSTScrapling ABI version is incompatible".to_owned());
        }
        let extract = *library
            .get(b"encorehub_rust_scrapling_extract_html\0")
            .map_err(|_| "RUSTScrapling extraction symbol is missing".to_owned())?;
        Ok(ScraplingLibrary {
            _library: library,
            extract,
        })
    }
}

fn library_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = CONFIGURED_PATH.get() {
        candidates.push(path.clone());
    }
    if let Some(path) = std::env::var_os("ENCOREHUB_RUST_SCRAPLING_LIBRARY") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join(rust_scrapling_library_file()));
            candidates.push(parent.join("lib").join(rust_scrapling_library_file()));
        }
    }
    candidates
}

#[cfg(target_os = "windows")]
const fn rust_scrapling_library_file() -> &'static str {
    "encorehub_rust_scrapling.dll"
}
#[cfg(target_os = "linux")]
const fn rust_scrapling_library_file() -> &'static str {
    "libencorehub_rust_scrapling.so"
}
#[cfg(target_os = "macos")]
const fn rust_scrapling_library_file() -> &'static str {
    "libencorehub_rust_scrapling.dylib"
}

unsafe fn load_dynamic_library(path: &Path) -> Result<Library, libloading::Error> {
    #[cfg(target_os = "windows")]
    {
        use libloading::os::windows::{Library as WindowsLibrary, LOAD_WITH_ALTERED_SEARCH_PATH};
        return WindowsLibrary::load_with_flags(path, LOAD_WITH_ALTERED_SEARCH_PATH)
            .map(Into::into);
    }
    #[cfg(not(target_os = "windows"))]
    {
        Library::new(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_configuration_accepts_only_the_same_path() {
        let slot = OnceLock::new();
        let first = PathBuf::from("parser-a");
        configure_path_once(&slot, first.clone()).expect("first path");
        configure_path_once(&slot, first).expect("same path");
        assert!(configure_path_once(&slot, PathBuf::from("parser-b")).is_err());
    }
}
