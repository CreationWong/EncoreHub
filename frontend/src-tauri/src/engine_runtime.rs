//! Runtime loader for the versioned Engine dynamic-library ABI.

use std::ffi::{c_char, c_void, CStr};
use std::path::{Path, PathBuf};
use std::ptr;
use std::sync::Arc;
use std::time::Instant;

use libloading::Library;
use serde::Serialize;

use crate::logs::{Level, LogBuffer, Source};
use crate::runtime_paths::RuntimePaths;

pub const ENGINE_AUTH_TOKEN_ENV: &str = "ENCOREHUB_ENGINE_AUTH_TOKEN";
pub const ENGINE_RUNTIME_LIBRARY_ENV: &str = "ENCOREHUB_ENGINE_RUNTIME_LIBRARY";
pub const ENGINE_RUNTIME_ABI_VERSION: u32 = 1;

#[cfg(target_os = "windows")]
pub const ENGINE_RUNTIME_LIBRARY_FILE: &str = "encorehub_desktop_runtime.dll";
#[cfg(target_os = "linux")]
pub const ENGINE_RUNTIME_LIBRARY_FILE: &str = "libencorehub_desktop_runtime.so";
#[cfg(target_os = "macos")]
pub const ENGINE_RUNTIME_LIBRARY_FILE: &str = "libencorehub_desktop_runtime.dylib";

type AbiVersionFn = unsafe extern "C" fn() -> u32;
type LogCallback = unsafe extern "C" fn(u8, *const u8, usize, *mut c_void);
type StartFn = unsafe extern "C" fn(
    *const u8,
    usize,
    Option<LogCallback>,
    *mut c_void,
    *mut *mut c_void,
    *mut c_char,
    usize,
) -> i32;
type IsRunningFn = unsafe extern "C" fn(*mut c_void) -> u8;
type StopFn = unsafe extern "C" fn(*mut c_void);

pub struct EngineRuntimeLibrary {
    _library: Library,
    start: StartFn,
    is_running: IsRunningFn,
    stop: StopFn,
    path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig<'a> {
    database_path: &'a Path,
    skills_path: &'a Path,
    bind_addr: String,
    internal_auth_token: &'a str,
    log_level: &'a str,
}

pub struct EngineRuntimeHandle {
    library: Arc<EngineRuntimeLibrary>,
    raw: *mut c_void,
    log_context: *const LogBuffer,
    pub started: Instant,
}

// The opaque handle is synchronized by the runtime library and is stored
// behind ServiceState's Mutex. Its log context points to an Arc-owned buffer.
unsafe impl Send for EngineRuntimeHandle {}

impl EngineRuntimeLibrary {
    pub fn load(resource_dir: &Path) -> Result<Arc<Self>, String> {
        let candidates = library_candidates(resource_dir);
        let path = candidates
            .iter()
            .find(|candidate| candidate.is_file())
            .cloned()
            .ok_or_else(|| {
                format!(
                    "Engine Runtime library was not found; checked {}",
                    candidates
                        .iter()
                        .map(|path| path.display().to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            })?;

        unsafe {
            let library = Library::new(&path).map_err(|error| {
                format!(
                    "failed to load Engine Runtime at {}: {error}",
                    path.display()
                )
            })?;
            let abi_version: AbiVersionFn = *library
                .get(b"encorehub_engine_runtime_abi_version\0")
                .map_err(|error| format!("Engine Runtime ABI symbol is missing: {error}"))?;
            let actual_abi = abi_version();
            if actual_abi != ENGINE_RUNTIME_ABI_VERSION {
                return Err(format!(
                    "Engine Runtime ABI mismatch: desktop requires {}, library provides {}",
                    ENGINE_RUNTIME_ABI_VERSION, actual_abi
                ));
            }
            let start = *library
                .get(b"encorehub_engine_runtime_start\0")
                .map_err(|error| format!("Engine Runtime start symbol is missing: {error}"))?;
            let is_running = *library
                .get(b"encorehub_engine_runtime_is_running\0")
                .map_err(|error| format!("Engine Runtime status symbol is missing: {error}"))?;
            let stop = *library
                .get(b"encorehub_engine_runtime_stop\0")
                .map_err(|error| format!("Engine Runtime stop symbol is missing: {error}"))?;
            Ok(Arc::new(Self {
                _library: library,
                start,
                is_running,
                stop,
                path,
            }))
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn start(
        self: &Arc<Self>,
        runtime_paths: &RuntimePaths,
        port: u16,
        logs: Arc<LogBuffer>,
        internal_auth_token: &str,
    ) -> Result<EngineRuntimeHandle, String> {
        let config = serde_json::to_vec(&RuntimeConfig {
            database_path: &runtime_paths.database,
            skills_path: &runtime_paths.skills,
            bind_addr: format!("127.0.0.1:{port}"),
            internal_auth_token,
            log_level: std::env::var("RUST_LOG").as_deref().unwrap_or("info"),
        })
        .map_err(|error| format!("failed to encode Engine Runtime configuration: {error}"))?;
        let log_context = Arc::into_raw(logs);
        let mut raw = ptr::null_mut();
        let mut error = [0_i8; 2048];
        let status = unsafe {
            (self.start)(
                config.as_ptr(),
                config.len(),
                Some(engine_log_callback),
                log_context.cast_mut().cast(),
                &mut raw,
                error.as_mut_ptr(),
                error.len(),
            )
        };
        if status != 0 || raw.is_null() {
            unsafe { drop(Arc::from_raw(log_context)) };
            let message = unsafe { CStr::from_ptr(error.as_ptr()) }
                .to_string_lossy()
                .into_owned();
            return Err(if message.is_empty() {
                format!("Engine Runtime failed to start with status {status}")
            } else {
                message
            });
        }
        Ok(EngineRuntimeHandle {
            library: self.clone(),
            raw,
            log_context,
            started: Instant::now(),
        })
    }
}

impl EngineRuntimeHandle {
    pub fn is_running(&self) -> bool {
        unsafe { (self.library.is_running)(self.raw) != 0 }
    }

    pub fn stop(mut self) {
        self.stop_inner();
    }

    fn stop_inner(&mut self) {
        if self.raw.is_null() {
            return;
        }
        unsafe {
            (self.library.stop)(self.raw);
            drop(Arc::from_raw(self.log_context));
        }
        self.raw = ptr::null_mut();
        self.log_context = ptr::null();
    }
}

impl Drop for EngineRuntimeHandle {
    fn drop(&mut self) {
        self.stop_inner();
    }
}

fn library_candidates(resource_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(configured) = std::env::var_os(ENGINE_RUNTIME_LIBRARY_ENV) {
        candidates.push(PathBuf::from(configured));
    }
    candidates.push(resource_dir.join("lib").join(ENGINE_RUNTIME_LIBRARY_FILE));
    candidates.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(ENGINE_RUNTIME_LIBRARY_FILE),
    );
    candidates
}

unsafe extern "C" fn engine_log_callback(
    level: u8,
    message_ptr: *const u8,
    message_len: usize,
    context: *mut c_void,
) {
    let _ = std::panic::catch_unwind(|| {
        if message_ptr.is_null() || context.is_null() {
            return;
        }
        let message = unsafe { std::slice::from_raw_parts(message_ptr, message_len) };
        let message = String::from_utf8_lossy(message);
        let logs = unsafe { &*context.cast::<LogBuffer>() };
        let level = match level {
            1 => Level::Error,
            2 => Level::Warn,
            4 => Level::Debug,
            _ => Level::Info,
        };
        logs.push_event(Source::Engine, level, &message);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_library_has_a_dynamic_library_extension() {
        let valid = ENGINE_RUNTIME_LIBRARY_FILE.ends_with(".dll")
            || ENGINE_RUNTIME_LIBRARY_FILE.ends_with(".so")
            || ENGINE_RUNTIME_LIBRARY_FILE.ends_with(".dylib");
        assert!(valid);
    }

    #[test]
    fn environment_override_is_the_first_candidate() {
        let configured = PathBuf::from("custom-engine-runtime");
        std::env::set_var(ENGINE_RUNTIME_LIBRARY_ENV, &configured);
        let candidates = library_candidates(Path::new("resources"));
        std::env::remove_var(ENGINE_RUNTIME_LIBRARY_ENV);
        assert_eq!(candidates.first(), Some(&configured));
    }
}
