//! Stable C ABI for the independently upgradable desktop Engine Runtime.

use std::ffi::{c_char, c_void};
use std::fmt::Write as _;
use std::path::PathBuf;
use std::ptr;
use std::slice;
use std::str;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread;

use encorehub_engine::logging::{normalize_level, LogControl};
use encorehub_engine::{Database, SkillRegistry};
use serde::Deserialize;
use tokio::sync::oneshot;
use tracing::field::{Field, Visit};
use tracing::Subscriber;
use tracing_subscriber::layer::Context;
use tracing_subscriber::{fmt, layer::SubscriberExt, reload, EnvFilter, Layer};

/// Increment only when an exported signature or ownership rule changes.
pub const ENGINE_RUNTIME_ABI_VERSION: u32 = 1;

const START_OK: i32 = 0;
const START_INVALID_ARGUMENT: i32 = 1;
const START_FAILED: i32 = 2;
const START_PANICKED: i32 = 3;

const LOG_ERROR: u8 = 1;
const LOG_WARN: u8 = 2;
const LOG_INFO: u8 = 3;
const LOG_DEBUG: u8 = 4;

type LogCallback = unsafe extern "C" fn(u8, *const u8, usize, *mut c_void);

static ACTIVE_RUNTIME: AtomicBool = AtomicBool::new(false);
static LOG_CALLBACK: OnceLock<LogCallback> = OnceLock::new();
static LOG_CONTEXT: AtomicUsize = AtomicUsize::new(0);
static LOG_CONTROL: OnceLock<LogControl> = OnceLock::new();

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
    database_path: PathBuf,
    skills_path: PathBuf,
    bind_addr: String,
    internal_auth_token: String,
    #[serde(default = "default_log_level")]
    log_level: String,
}

fn default_log_level() -> String {
    "info".into()
}

struct RuntimeHandle {
    shutdown: Option<oneshot::Sender<()>>,
    thread: Option<thread::JoinHandle<()>>,
    running: Arc<AtomicBool>,
}

#[no_mangle]
pub extern "C" fn encorehub_engine_runtime_abi_version() -> u32 {
    ENGINE_RUNTIME_ABI_VERSION
}

/// Start one Engine Runtime instance.
///
/// The returned handle is owned by the caller and must be passed exactly once
/// to [`encorehub_engine_runtime_stop`]. Configuration is UTF-8 JSON. Errors
/// are copied into the caller-owned buffer and are never allocated across the
/// dynamic-library boundary.
///
/// # Safety
///
/// `config_ptr` must reference `config_len` readable bytes for this call.
/// `out_handle` must be writable, and `error_ptr` must reference
/// `error_capacity` writable bytes when capacity is non-zero. The callback and
/// its context must remain valid until the returned handle is stopped.
#[no_mangle]
pub unsafe extern "C" fn encorehub_engine_runtime_start(
    config_ptr: *const u8,
    config_len: usize,
    callback: Option<LogCallback>,
    callback_context: *mut c_void,
    out_handle: *mut *mut c_void,
    error_ptr: *mut c_char,
    error_capacity: usize,
) -> i32 {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        start_inner(
            config_ptr,
            config_len,
            callback,
            callback_context,
            out_handle,
        )
    }));
    match result {
        Ok(Ok(())) => START_OK,
        Ok(Err((code, message))) => {
            write_error(error_ptr, error_capacity, &message);
            code
        }
        Err(_) => {
            write_error(
                error_ptr,
                error_capacity,
                "Engine Runtime panicked during startup",
            );
            START_PANICKED
        }
    }
}

unsafe fn start_inner(
    config_ptr: *const u8,
    config_len: usize,
    callback: Option<LogCallback>,
    callback_context: *mut c_void,
    out_handle: *mut *mut c_void,
) -> Result<(), (i32, String)> {
    if config_ptr.is_null() || config_len == 0 || out_handle.is_null() {
        return Err((
            START_INVALID_ARGUMENT,
            "Engine Runtime received an invalid startup argument".into(),
        ));
    }
    *out_handle = ptr::null_mut();
    let config_bytes = slice::from_raw_parts(config_ptr, config_len);
    let config_text = str::from_utf8(config_bytes).map_err(|error| {
        (
            START_INVALID_ARGUMENT,
            format!("Engine Runtime configuration is not UTF-8: {error}"),
        )
    })?;
    let config: RuntimeConfig = serde_json::from_str(config_text).map_err(|error| {
        (
            START_INVALID_ARGUMENT,
            format!("Engine Runtime configuration is invalid: {error}"),
        )
    })?;
    if config.internal_auth_token.trim().is_empty() {
        return Err((
            START_INVALID_ARGUMENT,
            "Engine Runtime internal authentication token is empty".into(),
        ));
    }

    let db = Database::open_and_return(&config.database_path).map_err(|error| {
        (
            START_FAILED,
            format!(
                "failed to open Engine database at {:?}: {error}",
                config.database_path
            ),
        )
    })?;
    let skills = SkillRegistry::load(&config.skills_path);
    let configured_level = db
        .get_config("log_level")
        .ok()
        .flatten()
        .and_then(|entry| serde_json::from_str::<String>(&entry.value_json).ok())
        .unwrap_or(config.log_level);
    let normalized_level = normalize_level(&configured_level).unwrap_or("info");
    if ACTIVE_RUNTIME
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err((
            START_FAILED,
            "an Engine Runtime instance is already active".into(),
        ));
    }
    if let Err(error) = configure_logging(callback, callback_context as usize, normalized_level) {
        ACTIVE_RUNTIME.store(false, Ordering::Release);
        LOG_CONTEXT.store(0, Ordering::Release);
        return Err(error);
    }
    let (shutdown, shutdown_rx) = oneshot::channel();
    let running = Arc::new(AtomicBool::new(true));
    let thread_running = running.clone();

    let runtime_thread = thread::Builder::new()
        .name("encorehub-engine-runtime".into())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .thread_name("encorehub-engine-worker")
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    emit_log(
                        LOG_ERROR,
                        &format!("failed to create Engine async runtime: {error}"),
                    );
                    thread_running.store(false, Ordering::Release);
                    return;
                }
            };

            tracing::info!(
                skills = skills.list().len(),
                bind_addr = %config.bind_addr,
                "Engine Runtime starting"
            );
            if let Err(error) = runtime.block_on(encorehub_engine::serve_with_shutdown(
                db,
                skills,
                LOG_CONTROL.get().cloned(),
                config.bind_addr,
                config.internal_auth_token,
                async move {
                    let _ = shutdown_rx.await;
                },
            )) {
                tracing::error!(%error, "Engine Runtime stopped with an error");
            }
            thread_running.store(false, Ordering::Release);
        })
        .map_err(|error| {
            ACTIVE_RUNTIME.store(false, Ordering::Release);
            LOG_CONTEXT.store(0, Ordering::Release);
            (
                START_FAILED,
                format!("failed to start Engine Runtime thread: {error}"),
            )
        })?;

    let handle = Box::new(RuntimeHandle {
        shutdown: Some(shutdown),
        thread: Some(runtime_thread),
        running,
    });
    *out_handle = Box::into_raw(handle).cast();
    Ok(())
}

#[no_mangle]
/// Return whether a handle created by this library is still serving.
///
/// # Safety
///
/// `handle` must be null or a live handle returned by
/// [`encorehub_engine_runtime_start`] that has not been stopped.
pub unsafe extern "C" fn encorehub_engine_runtime_is_running(handle: *mut c_void) -> u8 {
    if handle.is_null() {
        return 0;
    }
    let handle = &*handle.cast::<RuntimeHandle>();
    u8::from(handle.running.load(Ordering::Acquire))
}

#[no_mangle]
/// Stop and release one Engine Runtime handle.
///
/// # Safety
///
/// `handle` must be null or a live handle returned by
/// [`encorehub_engine_runtime_start`]. A non-null handle must be passed to this
/// function exactly once and cannot be queried after this call returns.
pub unsafe extern "C" fn encorehub_engine_runtime_stop(handle: *mut c_void) {
    if handle.is_null() {
        return;
    }
    let mut handle = Box::from_raw(handle.cast::<RuntimeHandle>());
    if let Some(shutdown) = handle.shutdown.take() {
        let _ = shutdown.send(());
    }
    if let Some(thread) = handle.thread.take() {
        let _ = thread.join();
    }
    handle.running.store(false, Ordering::Release);
    LOG_CONTEXT.store(0, Ordering::Release);
    ACTIVE_RUNTIME.store(false, Ordering::Release);
}

struct CallbackLayer;

impl<S: Subscriber> Layer<S> for CallbackLayer {
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        let mut visitor = MessageVisitor(String::new());
        event.record(&mut visitor);
        let metadata = event.metadata();
        let level = match *metadata.level() {
            tracing::Level::ERROR => LOG_ERROR,
            tracing::Level::WARN => LOG_WARN,
            tracing::Level::INFO => LOG_INFO,
            tracing::Level::DEBUG | tracing::Level::TRACE => LOG_DEBUG,
        };
        emit_log(level, &format!("{}:{}", metadata.target(), visitor.0));
    }
}

fn configure_logging(
    callback: Option<LogCallback>,
    context: usize,
    level: &str,
) -> Result<(), (i32, String)> {
    if let Some(callback) = callback {
        if let Some(existing) = LOG_CALLBACK.get() {
            if *existing as usize != callback as usize {
                return Err((
                    START_FAILED,
                    "Engine Runtime log callback changed within one process".into(),
                ));
            }
        } else {
            let _ = LOG_CALLBACK.set(callback);
        }
    }
    LOG_CONTEXT.store(context, Ordering::Release);

    if LOG_CONTROL.get().is_none() {
        let (filter_layer, reload_handle) = reload::Layer::new(EnvFilter::new(level));
        let log_control = LogControl::new(move |level| {
            let directive =
                normalize_level(level).ok_or_else(|| format!("invalid log level: {level}"))?;
            reload_handle
                .reload(EnvFilter::new(directive))
                .map_err(|error| error.to_string())
        });
        let subscriber = tracing_subscriber::registry()
            .with(filter_layer)
            .with(fmt::layer().with_target(false))
            .with(CallbackLayer);
        tracing::subscriber::set_global_default(subscriber).map_err(|error| {
            (
                START_FAILED,
                format!("failed to initialize Engine Runtime logging: {error}"),
            )
        })?;
        let _ = LOG_CONTROL.set(log_control);
    }
    LOG_CONTROL
        .get()
        .expect("Engine Runtime log control initialized")
        .set(level)
        .map_err(|error| (START_FAILED, error))
}

fn emit_log(level: u8, message: &str) {
    let Some(callback) = LOG_CALLBACK.get().copied() else {
        return;
    };
    let context = LOG_CONTEXT.load(Ordering::Acquire);
    if context == 0 {
        return;
    }
    let _ = std::panic::catch_unwind(|| unsafe {
        callback(
            level,
            message.as_ptr(),
            message.len(),
            context as *mut c_void,
        )
    });
}

struct MessageVisitor(String);

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            let _ = write!(self.0, " {value:?}");
        } else {
            let _ = write!(self.0, " {}={value:?}", field.name());
        }
    }
}

unsafe fn write_error(destination: *mut c_char, capacity: usize, message: &str) {
    if destination.is_null() || capacity == 0 {
        return;
    }
    let bytes = message.as_bytes();
    let length = bytes.len().min(capacity.saturating_sub(1));
    ptr::copy_nonoverlapping(bytes.as_ptr(), destination.cast::<u8>(), length);
    *destination.add(length) = 0;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_a_versioned_abi() {
        assert_eq!(encorehub_engine_runtime_abi_version(), 1);
    }

    #[test]
    fn rejects_missing_startup_data_without_allocating_a_handle() {
        let mut handle = ptr::null_mut();
        let mut error = [0_i8; 128];
        let status = unsafe {
            encorehub_engine_runtime_start(
                ptr::null(),
                0,
                None,
                ptr::null_mut(),
                &mut handle,
                error.as_mut_ptr(),
                error.len(),
            )
        };
        assert_eq!(status, START_INVALID_ARGUMENT);
        assert!(handle.is_null());
    }
}
