#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod log_layer;
mod logs;
mod runtime_paths;

use std::fmt::Write as _;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use rand::{rngs::OsRng, RngCore};
use serde::Serialize;
use tauri::{Manager, State};
use tracing_subscriber::{fmt, prelude::*, reload, EnvFilter};

use encorehub_engine::logging::{normalize_level, LogControl};
use encorehub_engine::{find_free_port, Database, SkillRegistry, ENGINE_AUTH_TOKEN_ENV};
use log_layer::LogBufferLayer;
use logs::{export_log_entries, Level, LogBuffer, LogEntry, Source};
#[cfg(target_os = "windows")]
use runtime_paths::legacy_migration::migrate_legacy_runtime;
use runtime_paths::RuntimePaths;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Default starting port for auto-negotiation in Tauri / client mode.
const CLIENT_PORT_START: u16 = 10000;

const FILE_LOG_LEVEL_CONFIG_KEY: &str = "file_log_level";

/// A spawned sidecar plus the metadata the developer panel reports.
struct ServiceHandle {
    child: CommandChild,
    pid: u32,
    started: Instant,
    running: Arc<AtomicBool>,
}

struct ServiceState {
    /// The engine now runs in-process (an axum task on Tauri's tokio runtime),
    /// so there is no child handle — just the start time for the uptime readout.
    engine_started: Instant,
    gateway: Mutex<Option<ServiceHandle>>,
    logs: Arc<LogBuffer>,
    /// Actual file-log directory. Normally beside the executable; app data is
    /// retained as a fallback for read-only system installations.
    log_dir: PathBuf,
    /// Dynamically negotiated ports (filled during setup).
    engine_port: u16,
    gateway_port: u16,
    /// Process-lifetime credential for trusted Rust/sidecar calls only. This
    /// state is intentionally not serializable and no Tauri command returns it.
    internal_auth_token: Arc<str>,
}

/// Port info returned to the frontend so it can build API URLs.
#[derive(Serialize, Clone, Copy)]
struct ServicePorts {
    gateway_port: u16,
}

/// Status snapshot for one process, surfaced to the developer panel.
#[derive(Serialize)]
struct ServiceStatus {
    name: String,
    pid: Option<u32>,
    /// Whether the child is still alive according to the sidecar event stream.
    /// The desktop process reports itself as always running.
    running: bool,
    uptime_secs: u64,
    /// Loopback port the service listens on (0 = the desktop app itself).
    port: u16,
}

#[tauri::command]
fn check_engine_health(state: State<ServiceState>) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{}/health/ready", state.engine_port);
    let authorization = format!("Bearer {}", state.internal_auth_token);
    match ureq::get(&url).set("Authorization", &authorization).call() {
        Ok(r) => r.into_string().map_err(|e| format!("{e}")),
        Err(e) => Err(format!("Engine not ready: {e}")),
    }
}

#[tauri::command]
fn check_gateway_health(state: State<ServiceState>) -> Result<String, String> {
    let url = format!(
        "http://127.0.0.1:{}/api/v1/health/ready",
        state.gateway_port
    );
    match ureq::get(&url).call() {
        Ok(r) => r.into_string().map_err(|e| format!("{e}")),
        Err(e) => Err(format!("Gateway not ready: {e}")),
    }
}

/// Return the negotiated ports so the frontend can construct API URLs.
#[tauri::command]
fn get_service_ports(state: State<ServiceState>) -> ServicePorts {
    ServicePorts {
        gateway_port: state.gateway_port,
    }
}

/// Status of the desktop app and both sidecars, for the developer panel.
#[tauri::command]
fn get_service_status(state: State<ServiceState>) -> Vec<ServiceStatus> {
    vec![
        ServiceStatus {
            name: "desktop".into(),
            pid: Some(std::process::id()),
            running: true,
            uptime_secs: 0,
            port: 0,
        },
        ServiceStatus {
            name: "engine".into(),
            pid: Some(std::process::id()),
            running: true,
            uptime_secs: state.engine_started.elapsed().as_secs(),
            port: state.engine_port,
        },
        status_of(&state.gateway, "gateway", state.gateway_port),
    ]
}

fn status_of(slot: &Mutex<Option<ServiceHandle>>, name: &str, port: u16) -> ServiceStatus {
    let guard = slot.lock().unwrap();
    match guard.as_ref() {
        Some(h) => ServiceStatus {
            name: name.into(),
            pid: Some(h.pid),
            running: h.running.load(Ordering::Acquire),
            uptime_secs: h.started.elapsed().as_secs(),
            port,
        },
        None => ServiceStatus {
            name: name.into(),
            pid: None,
            running: false,
            uptime_secs: 0,
            port,
        },
    }
}

/// Pull every log line after the given sequence number (0 = from the start).
#[tauri::command]
fn get_logs(state: State<ServiceState>, after: u64) -> Vec<LogEntry> {
    state.logs.since(after)
}

/// Clear the in-memory log buffer.
#[tauri::command]
fn clear_logs(state: State<ServiceState>) {
    state.logs.clear();
}

#[tauri::command]
fn export_logs(
    app: tauri::AppHandle,
    state: State<ServiceState>,
    entries: Vec<LogEntry>,
) -> Result<String, String> {
    let download_dir = app.path().download_dir().ok();
    let path = export_log_entries(download_dir.as_deref(), &state.log_dir, &entries)
        .map_err(|error| format!("failed to export logs: {error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
#[allow(deprecated)]
fn open_log_directory(app: tauri::AppHandle, state: State<ServiceState>) -> Result<String, String> {
    std::fs::create_dir_all(&state.log_dir)
        .map_err(|error| format!("failed to prepare log directory: {error}"))?;
    let path = state.log_dir.to_string_lossy().into_owned();
    app.shell()
        .open(path.clone(), None)
        .map_err(|error| format!("failed to open log directory: {error}"))?;
    Ok(path)
}

#[tauri::command]
fn get_file_log_level(state: State<ServiceState>) -> String {
    state.logs.file_level().as_str().to_string()
}

#[tauri::command]
fn set_file_log_level(state: State<ServiceState>, level: String) -> Result<String, String> {
    let parsed = Level::parse(&level).ok_or_else(|| format!("invalid file log level: {level}"))?;
    persist_file_log_level(state.engine_port, parsed, &state.internal_auth_token)?;
    state.logs.set_file_level(parsed);
    tracing::info!("file log level changed to {}", parsed.as_str());
    Ok(parsed.as_str().to_string())
}

#[tauri::command]
fn write_client_log(
    state: State<ServiceState>,
    level: String,
    message: String,
) -> Result<(), String> {
    let parsed =
        Level::parse(&level).ok_or_else(|| format!("invalid client log level: {level}"))?;
    state.logs.push_event(Source::Frontend, parsed, &message);
    Ok(())
}

/// Open the webview's native DevTools (inspector). Available in release builds
/// because the `devtools` Cargo feature is enabled; without it this method
/// would only exist in debug builds.
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

fn persist_file_log_level(
    engine_port: u16,
    level: Level,
    internal_auth_token: &str,
) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{engine_port}/api/config/{FILE_LOG_LEVEL_CONFIG_KEY}");
    let body = serde_json::to_string(level.as_str())
        .map_err(|e| format!("failed to encode file log level: {e}"))?;
    ureq::put(&url)
        .set("Content-Type", "application/json")
        .set("Authorization", &format!("Bearer {internal_auth_token}"))
        .send_string(&body)
        .map(|_| ())
        .map_err(|e| format!("failed to persist file log level: {e}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            check_engine_health,
            check_gateway_health,
            get_service_ports,
            get_service_status,
            get_logs,
            clear_logs,
            export_logs,
            open_log_directory,
            get_file_log_level,
            set_file_log_level,
            write_client_log,
            open_devtools,
        ])
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let resource_dir = app.path().resource_dir()?;
            let executable_dir = std::env::current_exe()
                .ok()
                .and_then(|path| path.parent().map(|parent| parent.to_path_buf()));

            #[cfg(target_os = "windows")]
            let migration_report = executable_dir
                .as_deref()
                .map(|legacy_root| migrate_legacy_runtime(legacy_root, &app_data_dir))
                .transpose()?;

            let runtime_paths =
                RuntimePaths::prepare(&app_data_dir, &resource_dir, executable_dir.as_deref())?;
            let logs = Arc::new(LogBuffer::with_log_dir(runtime_paths.logs.clone()));
            let log_control = install_logging(logs.clone());
            let internal_auth_token: Arc<str> = generate_internal_auth_token().into();
            let (engine_port, gateway_port) = negotiate_ports();

            #[cfg(target_os = "windows")]
            if let Some(report) = migration_report.filter(|report| report.marker_created) {
                if report.preserved_conflicts > 0 {
                    tracing::warn!(
                        copied_files = report.copied_files,
                        preserved_conflicts = report.preserved_conflicts,
                        "legacy runtime conflicts preserved without overwriting app data"
                    );
                } else {
                    tracing::info!(
                        copied_files = report.copied_files,
                        verified_existing_files = report.verified_existing_files,
                        "legacy runtime migration recorded"
                    );
                }
            }

            tracing::info!("EncoreHub app data: {:?}", app_data_dir);
            tracing::info!("EncoreHub log directory: {:?}", runtime_paths.logs);
            tracing::info!("EncoreHub resources: {:?}", resource_dir);
            tracing::info!("Ports: engine={engine_port} gateway={gateway_port}");

            app.manage(ServiceState {
                engine_started: Instant::now(),
                gateway: Mutex::new(None),
                logs: logs.clone(),
                log_dir: runtime_paths.logs.clone(),
                engine_port,
                gateway_port,
                internal_auth_token: internal_auth_token.clone(),
            });

            // ---- Start engine in-process ----
            start_engine(
                &runtime_paths,
                log_control,
                engine_port,
                logs.clone(),
                internal_auth_token.clone(),
            );

            // ---- Spawn gateway (still a sidecar) ----
            if let Some(handle) =
                spawn_gateway(app, &logs, engine_port, gateway_port, &internal_auth_token)
            {
                app.state::<ServiceState>()
                    .gateway
                    .lock()
                    .unwrap()
                    .replace(handle);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let gateway = {
                    window
                        .state::<ServiceState>()
                        .gateway
                        .lock()
                        .unwrap()
                        .take()
                };
                if let Some(h) = gateway {
                    let _ = h.child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running EncoreHub");
}

fn install_logging(logs: Arc<LogBuffer>) -> LogControl {
    let initial_filter =
        EnvFilter::new(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()));
    let (filter_layer, reload_handle) = reload::Layer::new(initial_filter);
    tracing_subscriber::registry()
        .with(filter_layer)
        .with(fmt::layer().with_target(false))
        .with(LogBufferLayer::new(logs))
        .init();

    LogControl::new(move |level| {
        let directive =
            normalize_level(level).ok_or_else(|| format!("invalid log level: {level}"))?;
        reload_handle
            .reload(EnvFilter::new(directive))
            .map_err(|error| error.to_string())
    })
}

fn negotiate_ports() -> (u16, u16) {
    let engine_port = std::env::var("ENGINE_BIND")
        .ok()
        .and_then(|value| value.rsplit(':').next()?.parse().ok())
        .unwrap_or_else(|| find_free_port(CLIENT_PORT_START));
    let gateway_port = std::env::var("LISTEN_ADDR")
        .ok()
        .and_then(|value| value.rsplit(':').next()?.parse().ok())
        .unwrap_or_else(|| find_free_port(engine_port + 1));
    (engine_port, gateway_port)
}

/// Open the engine's database + skills and start its axum service on Tauri's
/// tokio runtime. Replaces the old `spawn_service(.., "encorehub-engine", ..)`
/// path — the engine is now a library task in this process, not a sidecar exe.
fn start_engine(
    runtime_paths: &RuntimePaths,
    log_control: LogControl,
    port: u16,
    logs: Arc<LogBuffer>,
    internal_auth_token: Arc<str>,
) {
    let db = match Database::open_and_return(&runtime_paths.database) {
        Ok(db) => db,
        Err(e) => {
            tracing::error!(
                "failed to open engine database at {:?}: {e}",
                runtime_paths.database
            );
            return;
        }
    };

    if let Ok(Some(entry)) = db.get_config("log_level") {
        if let Ok(level) = serde_json::from_str::<String>(&entry.value_json) {
            let _ = log_control.set(&level);
        }
    }

    if let Ok(Some(entry)) = db.get_config(FILE_LOG_LEVEL_CONFIG_KEY) {
        match serde_json::from_str::<String>(&entry.value_json)
            .ok()
            .and_then(|level| Level::parse(&level))
        {
            Some(level) => {
                logs.set_file_level(level);
                tracing::info!("applied persisted file log level: {}", level.as_str());
            }
            None => {
                tracing::warn!(
                    "ignored invalid persisted file log level: {}",
                    entry.value_json
                );
            }
        }
    }

    let skill_registry = SkillRegistry::load(&runtime_paths.skills);
    tracing::info!("Skills loaded: {} total", skill_registry.list().len());

    let bind_addr = format!("127.0.0.1:{port}");
    tracing::info!("Engine starting in-process on http://{bind_addr}");

    tauri::async_runtime::spawn(async move {
        if let Err(e) = encorehub_engine::serve(
            db,
            skill_registry,
            Some(log_control),
            bind_addr,
            internal_auth_token.to_string(),
        )
        .await
        {
            tracing::error!("engine serve exited: {e}");
        }
    });
}

/// Resolve and spawn the bundled Gateway through Tauri's platform-aware
/// sidecar API, then forward its event stream into the shared log buffer.
fn spawn_gateway(
    app: &tauri::App,
    logs: &Arc<LogBuffer>,
    engine_port: u16,
    gateway_port: u16,
    internal_auth_token: &str,
) -> Option<ServiceHandle> {
    let command = match app.shell().sidecar("gateway") {
        Ok(command) => command.envs(gateway_environment(
            engine_port,
            gateway_port,
            internal_auth_token,
        )),
        Err(error) => {
            tracing::error!("failed to resolve Gateway sidecar: {error}");
            return None;
        }
    };

    match command.spawn() {
        Ok((mut events, child)) => {
            let pid = child.pid();
            let running = Arc::new(AtomicBool::new(true));
            let event_running = running.clone();
            let event_logs = logs.clone();
            tracing::info!("Gateway started (pid: {pid})");

            tauri::async_runtime::spawn(async move {
                let source = Source::from_service("gateway");
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            push_sidecar_line(&event_logs, source, "out", &bytes);
                        }
                        CommandEvent::Stderr(bytes) => {
                            push_sidecar_line(&event_logs, source, "err", &bytes);
                        }
                        CommandEvent::Error(error) => {
                            event_logs.push(
                                source,
                                "err",
                                &format!("Gateway sidecar event error: {error}"),
                            );
                        }
                        CommandEvent::Terminated(payload) => {
                            event_running.store(false, Ordering::Release);
                            let stream = if payload.code == Some(0) {
                                "out"
                            } else {
                                "err"
                            };
                            event_logs.push(
                                source,
                                stream,
                                &format!(
                                    "Gateway exited: code={:?} signal={:?}",
                                    payload.code, payload.signal
                                ),
                            );
                        }
                        _ => {}
                    }
                }
                event_running.store(false, Ordering::Release);
            });

            Some(ServiceHandle {
                child,
                pid,
                started: Instant::now(),
                running,
            })
        }
        Err(error) => {
            tracing::error!("failed to start Gateway sidecar: {error}");
            None
        }
    }
}

fn generate_internal_auth_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);

    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut token, "{byte:02x}").expect("writing to a String cannot fail");
    }
    token
}

fn gateway_environment(
    engine_port: u16,
    gateway_port: u16,
    internal_auth_token: &str,
) -> [(String, String); 4] {
    [
        (
            "ENGINE_URL".into(),
            format!("http://127.0.0.1:{engine_port}"),
        ),
        ("LISTEN_ADDR".into(), format!("127.0.0.1:{gateway_port}")),
        ("GIN_MODE".into(), "release".into()),
        (ENGINE_AUTH_TOKEN_ENV.into(), internal_auth_token.into()),
    ]
}

fn push_sidecar_line(logs: &LogBuffer, source: Source, stream: &'static str, bytes: &[u8]) {
    let line = String::from_utf8_lossy(bytes);
    let line = line.trim_end_matches(['\r', '\n']);
    if !line.is_empty() {
        logs.push(source, stream, line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn generated_internal_tokens_are_high_entropy_and_unique() {
        let first = generate_internal_auth_token();
        let second = generate_internal_auth_token();

        assert_eq!(first.len(), 64);
        assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn gateway_command_receives_internal_token_without_frontend_exposure() {
        const TOKEN: &str = "wf02-desktop-token-canary";
        let env: HashMap<_, _> = gateway_environment(10000, 10001, TOKEN)
            .into_iter()
            .collect();
        assert_eq!(
            env.get(ENGINE_AUTH_TOKEN_ENV).map(String::as_str),
            Some(TOKEN)
        );
        assert_eq!(env.get("GIN_MODE").map(String::as_str), Some("release"));
        assert_eq!(
            env.get("ENGINE_URL").map(String::as_str),
            Some("http://127.0.0.1:10000")
        );
        assert_eq!(
            env.get("LISTEN_ADDR").map(String::as_str),
            Some("127.0.0.1:10001")
        );

        let ports = serde_json::to_string(&ServicePorts {
            gateway_port: 10001,
        })
        .unwrap();
        assert!(!ports.contains(TOKEN));
        assert!(!ports.contains(ENGINE_AUTH_TOKEN_ENV));
    }

    #[test]
    fn desktop_runtime_creates_daily_log_in_portable_install_directory() {
        let temp = tempfile::tempdir().unwrap();
        let install = temp.path().join("install");
        let app_data = temp.path().join("app-data");
        let resources = temp.path().join("resources");
        std::fs::create_dir_all(&install).unwrap();
        let paths = RuntimePaths::prepare(&app_data, &resources, Some(&install)).unwrap();
        let logs = LogBuffer::with_log_dir(paths.logs.clone());

        logs.push_event(Source::Desktop, Level::Info, "portable log initialized");

        let day = chrono::Local::now().format("%Y-%m-%d");
        let file = install.join("log").join(format!("encorehub-{day}.log"));
        assert_eq!(paths.logs, install.join("log"));
        assert!(file.is_file());
        assert!(std::fs::read_to_string(file)
            .unwrap()
            .contains("portable log initialized"));
    }
}
