#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_info;
mod engine_runtime;
mod log_layer;
mod logs;
mod runtime_paths;

use std::fmt::Write as _;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Once};
use std::time::{Duration, Instant};

use rand::{rngs::OsRng, RngCore};
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use tauri::{Manager, State};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use app_info::get_app_info;
use engine_runtime::{EngineRuntimeHandle, EngineRuntimeLibrary, ENGINE_AUTH_TOKEN_ENV};
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

#[cfg(any(target_os = "windows", test))]
const NATIVE_TITLEBAR_ROLLBACK_ENV: &str = "ENCOREHUB_NATIVE_TITLEBAR";

#[cfg(any(target_os = "windows", test))]
fn native_titlebar_rollback_value(value: Option<&str>) -> bool {
    value.is_some_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes"
        )
    })
}

#[cfg(target_os = "windows")]
fn native_titlebar_rollback_requested() -> bool {
    native_titlebar_rollback_value(std::env::var(NATIVE_TITLEBAR_ROLLBACK_ENV).ok().as_deref())
}

#[tauri::command]
fn use_custom_titlebar() -> bool {
    #[cfg(target_os = "windows")]
    {
        !native_titlebar_rollback_requested()
    }

    #[cfg(not(target_os = "windows"))]
    false
}

/// A spawned sidecar plus the metadata the developer panel reports.
struct ServiceHandle {
    child: CommandChild,
    pid: u32,
    started: Instant,
    running: Arc<AtomicBool>,
}

struct ServiceState {
    engine: Mutex<Option<EngineRuntimeHandle>>,
    engine_library: Arc<EngineRuntimeLibrary>,
    gateway: Mutex<Option<ServiceHandle>>,
    logs: Arc<LogBuffer>,
    /// File logs share the platform app-data root with the SQLite database.
    log_dir: PathBuf,
    /// Dynamically negotiated ports (filled during setup).
    engine_port: u16,
    gateway_port: u16,
    /// Process-lifetime credential for trusted Rust/sidecar calls only. This
    /// state is intentionally not serializable and no Tauri command returns it.
    internal_auth_token: Arc<str>,
    runtime_paths: RuntimePaths,
    developer_mode: AtomicBool,
    full_communication_logs: AtomicBool,
}

/// Port info returned to the frontend so it can build API URLs.
#[derive(Serialize, Clone, Copy)]
struct ServicePorts {
    gateway_port: u16,
}

#[derive(Serialize)]
struct DatabaseTable {
    name: String,
    columns: Vec<String>,
    row_count: u64,
}

#[derive(Serialize)]
struct DatabaseOverview {
    path: String,
    tables: Vec<DatabaseTable>,
}

#[derive(Serialize)]
struct DatabasePage {
    table: String,
    columns: Vec<String>,
    rows: Vec<Vec<Option<String>>>,
    total_rows: u64,
    limit: u32,
    offset: u64,
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
        engine_status(&state.engine, state.engine_port),
        status_of(&state.gateway, "gateway", state.gateway_port),
    ]
}

fn engine_status(slot: &Mutex<Option<EngineRuntimeHandle>>, port: u16) -> ServiceStatus {
    let guard = slot.lock().unwrap();
    match guard.as_ref() {
        Some(handle) => ServiceStatus {
            name: "engine".into(),
            pid: Some(std::process::id()),
            running: handle.is_running(),
            uptime_secs: handle.started.elapsed().as_secs(),
            port,
        },
        None => ServiceStatus {
            name: "engine".into(),
            pid: None,
            running: false,
            uptime_secs: 0,
            port,
        },
    }
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
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let default_name = format!(
        "encorehub-logs-{}.txt",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("Text log", &["txt"])
        .set_file_name(default_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|error| format!("invalid export path: {error}"))?;
    export_log_entries(
        &path,
        &entries,
        state.full_communication_logs.load(Ordering::Acquire),
    )
    .map_err(|error| format!("failed to export logs: {error}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
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

#[tauri::command]
fn get_developer_mode(state: State<ServiceState>) -> bool {
    state.developer_mode.load(Ordering::Acquire)
}

#[tauri::command]
async fn set_developer_mode(
    app: tauri::AppHandle,
    state: State<'_, ServiceState>,
    enabled: bool,
) -> Result<bool, String> {
    let previous = state.developer_mode.swap(enabled, Ordering::AcqRel);
    if previous != enabled {
        tracing::info!(
            "developer features {}",
            if enabled { "enabled" } else { "disabled" }
        );
    }

    let disabled_full_logs =
        !enabled && state.full_communication_logs.swap(false, Ordering::AcqRel);
    if disabled_full_logs {
        state.logs.set_preserve_diagnostics(false);
        tracing::info!("full communication logging disabled with developer features");
        restart_gateway_process(&app, &state).await?;
    }
    Ok(enabled)
}

#[tauri::command]
fn get_full_communication_logs(state: State<ServiceState>) -> bool {
    state.full_communication_logs.load(Ordering::Acquire)
}

#[tauri::command]
async fn set_full_communication_logs(
    app: tauri::AppHandle,
    state: State<'_, ServiceState>,
    enabled: bool,
) -> Result<bool, String> {
    if enabled {
        require_developer_mode(&state)?;
    }
    let previous = state
        .full_communication_logs
        .swap(enabled, Ordering::AcqRel);
    if previous == enabled {
        return Ok(enabled);
    }

    state.logs.set_preserve_diagnostics(enabled);
    if enabled {
        tracing::warn!(
            "full communication logging enabled; request and response bodies may contain sensitive data"
        );
    } else {
        tracing::info!("restricted logging restored");
    }
    restart_gateway_process(&app, &state).await?;
    Ok(enabled)
}

#[tauri::command]
async fn restart_gateway(
    app: tauri::AppHandle,
    state: State<'_, ServiceState>,
) -> Result<ServiceStatus, String> {
    require_developer_mode(&state)?;
    restart_gateway_process(&app, &state).await?;
    Ok(status_of(&state.gateway, "gateway", state.gateway_port))
}

#[tauri::command]
async fn restart_engine(state: State<'_, ServiceState>) -> Result<ServiceStatus, String> {
    require_developer_mode(&state)?;

    if let Some(handle) = state.engine.lock().unwrap().take() {
        handle.stop();
    }

    let handle = state.engine_library.start(
        &state.runtime_paths,
        state.engine_port,
        state.logs.clone(),
        &state.internal_auth_token,
    )?;
    state.engine.lock().unwrap().replace(handle);
    tracing::info!("Engine restart completed");
    Ok(engine_status(&state.engine, state.engine_port))
}

#[tauri::command]
fn get_database_overview(state: State<ServiceState>) -> Result<DatabaseOverview, String> {
    require_developer_mode(&state)?;
    let connection = open_developer_database(&state.runtime_paths.database)?;
    let mut statement = connection
        .prepare(
            "SELECT name FROM sqlite_schema \
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .map_err(|error| format!("failed to inspect database tables: {error}"))?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("failed to list database tables: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to decode database table: {error}"))?;

    let mut tables = Vec::with_capacity(names.len());
    for name in names {
        let columns = database_columns(&connection, &name)?;
        let sql = format!("SELECT COUNT(*) FROM {}", quoted_identifier(&name));
        let row_count = connection
            .query_row(&sql, [], |row| row.get::<_, i64>(0))
            .map_err(|error| format!("failed to count table {name}: {error}"))?
            .max(0) as u64;
        tables.push(DatabaseTable {
            name,
            columns,
            row_count,
        });
    }

    state.logs.push_event(
        Source::Desktop,
        Level::Info,
        &format!("[database/read] listed {} tables", tables.len()),
    );
    Ok(DatabaseOverview {
        path: state.runtime_paths.database.to_string_lossy().into_owned(),
        tables,
    })
}

#[tauri::command]
fn get_database_rows(
    state: State<ServiceState>,
    table: String,
    limit: u32,
    offset: u64,
) -> Result<DatabasePage, String> {
    require_developer_mode(&state)?;
    let connection = open_developer_database(&state.runtime_paths.database)?;
    let exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)",
            [&table],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("failed to validate database table: {error}"))?;
    if !exists {
        return Err(format!("unknown database table: {table}"));
    }

    let columns = database_columns(&connection, &table)?;
    let quoted = quoted_identifier(&table);
    let total_rows = connection
        .query_row(&format!("SELECT COUNT(*) FROM {quoted}"), [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| format!("failed to count table {table}: {error}"))?
        .max(0) as u64;
    let limit = limit.clamp(1, 200);
    let mut statement = connection
        .prepare(&format!("SELECT * FROM {quoted} LIMIT ?1 OFFSET ?2"))
        .map_err(|error| format!("failed to read table {table}: {error}"))?;
    let mut query = statement
        .query((limit, offset))
        .map_err(|error| format!("failed to query table {table}: {error}"))?;
    let mut rows = Vec::new();
    while let Some(row) = query
        .next()
        .map_err(|error| format!("failed to iterate table {table}: {error}"))?
    {
        let mut cells = Vec::with_capacity(columns.len());
        for index in 0..columns.len() {
            let value = row
                .get_ref(index)
                .map_err(|error| format!("failed to read {table} column {index}: {error}"))?;
            cells.push(database_value(value));
        }
        rows.push(cells);
    }

    state.logs.push_event(
        Source::Desktop,
        Level::Info,
        &format!(
            "[database/read] table={} offset={} rows={}",
            table,
            offset,
            rows.len()
        ),
    );
    Ok(DatabasePage {
        table,
        columns,
        rows,
        total_rows,
        limit,
        offset,
    })
}

fn require_developer_mode(state: &ServiceState) -> Result<(), String> {
    state
        .developer_mode
        .load(Ordering::Acquire)
        .then_some(())
        .ok_or_else(|| "developer mode is not enabled".to_string())
}

async fn restart_gateway_process(
    app: &tauri::AppHandle,
    state: &ServiceState,
) -> Result<(), String> {
    if let Some(handle) = state.gateway.lock().unwrap().take() {
        handle
            .child
            .kill()
            .map_err(|error| format!("failed to stop Gateway: {error}"))?;
    }
    tokio::time::sleep(Duration::from_millis(150)).await;

    let handle = spawn_gateway(
        app,
        &state.logs,
        state.engine_port,
        state.gateway_port,
        &state.internal_auth_token,
        state.full_communication_logs.load(Ordering::Acquire),
    )
    .ok_or_else(|| "failed to start Gateway; inspect desktop logs".to_string())?;
    state.gateway.lock().unwrap().replace(handle);
    Ok(())
}

fn open_developer_database(path: &std::path::Path) -> Result<Connection, String> {
    register_sqlite_vec();
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("failed to open database read-only: {error}"))
}

fn register_sqlite_vec() {
    static REGISTER: Once = Once::new();
    REGISTER.call_once(|| unsafe {
        type ExtensionEntry = unsafe extern "C" fn(
            *mut rusqlite::ffi::sqlite3,
            *mut *mut std::ffi::c_char,
            *const rusqlite::ffi::sqlite3_api_routines,
        ) -> std::ffi::c_int;
        let entry = std::mem::transmute::<*const (), ExtensionEntry>(
            sqlite_vec::sqlite3_vec_init as *const (),
        );
        rusqlite::ffi::sqlite3_auto_extension(Some(entry));
    });
}

fn database_columns(connection: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({})", quoted_identifier(table)))
        .map_err(|error| format!("failed to inspect table {table}: {error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("failed to list columns for {table}: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to decode columns for {table}: {error}"))?;
    Ok(columns)
}

fn quoted_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn database_value(value: ValueRef<'_>) -> Option<String> {
    match value {
        ValueRef::Null => None,
        ValueRef::Integer(value) => Some(value.to_string()),
        ValueRef::Real(value) => Some(value.to_string()),
        ValueRef::Text(value) => Some(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => {
            const PREVIEW_BYTES: usize = 256;
            let mut encoded = String::with_capacity(value.len().min(PREVIEW_BYTES) * 2 + 32);
            for byte in value.iter().take(PREVIEW_BYTES) {
                write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
            }
            if value.len() > PREVIEW_BYTES {
                write!(&mut encoded, "… ({} bytes)", value.len())
                    .expect("writing to a String cannot fail");
            }
            Some(encoded)
        }
    }
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            check_engine_health,
            check_gateway_health,
            get_service_ports,
            get_app_info,
            get_service_status,
            get_logs,
            clear_logs,
            export_logs,
            open_log_directory,
            get_file_log_level,
            set_file_log_level,
            write_client_log,
            get_developer_mode,
            set_developer_mode,
            get_full_communication_logs,
            set_full_communication_logs,
            restart_gateway,
            restart_engine,
            get_database_overview,
            get_database_rows,
            open_devtools,
            use_custom_titlebar,
        ])
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let resource_dir = app.path().resource_dir()?;
            #[cfg(target_os = "windows")]
            let executable_dir = std::env::current_exe()
                .ok()
                .and_then(|path| path.parent().map(|parent| parent.to_path_buf()));

            #[cfg(target_os = "windows")]
            let migration_report = executable_dir
                .as_deref()
                .map(|legacy_root| migrate_legacy_runtime(legacy_root, &app_data_dir))
                .transpose()?;

            let runtime_paths = RuntimePaths::prepare(&app_data_dir, &resource_dir)?;
            let logs = Arc::new(LogBuffer::with_log_dir(runtime_paths.logs.clone()));
            install_logging(logs.clone());
            let engine_library =
                EngineRuntimeLibrary::load(&resource_dir).map_err(std::io::Error::other)?;

            #[cfg(target_os = "windows")]
            if native_titlebar_rollback_requested() {
                if let Some(window) = app.get_webview_window("main") {
                    window.set_decorations(true)?;
                    tracing::warn!(
                        environment = NATIVE_TITLEBAR_ROLLBACK_ENV,
                        "native Windows titlebar rollback enabled"
                    );
                }
            }

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
            tracing::info!("Engine Runtime library: {:?}", engine_library.path());
            tracing::info!("Ports: engine={engine_port} gateway={gateway_port}");

            let engine = engine_library
                .start(
                    &runtime_paths,
                    engine_port,
                    logs.clone(),
                    &internal_auth_token,
                )
                .map_err(std::io::Error::other)?;
            apply_persisted_file_log_level(&runtime_paths.database, &logs);

            app.manage(ServiceState {
                engine: Mutex::new(Some(engine)),
                engine_library,
                gateway: Mutex::new(None),
                logs: logs.clone(),
                log_dir: runtime_paths.logs.clone(),
                engine_port,
                gateway_port,
                internal_auth_token: internal_auth_token.clone(),
                runtime_paths: runtime_paths.clone(),
                developer_mode: AtomicBool::new(false),
                full_communication_logs: AtomicBool::new(false),
            });

            // ---- Spawn gateway (still a sidecar) ----
            if let Some(handle) = spawn_gateway(
                app.handle(),
                &logs,
                engine_port,
                gateway_port,
                &internal_auth_token,
                false,
            ) {
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
                if let Some(engine) = window.state::<ServiceState>().engine.lock().unwrap().take() {
                    engine.stop();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running EncoreHub");
}

fn install_logging(logs: Arc<LogBuffer>) {
    let initial_filter =
        EnvFilter::new(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()));
    tracing_subscriber::registry()
        .with(initial_filter)
        .with(fmt::layer().with_target(false))
        .with(LogBufferLayer::new(logs))
        .init();
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

fn find_free_port(start_port: u16) -> u16 {
    (start_port..=u16::MAX)
        .find(|port| std::net::TcpListener::bind(("127.0.0.1", *port)).is_ok())
        .unwrap_or(start_port)
}

fn apply_persisted_file_log_level(database_path: &std::path::Path, logs: &LogBuffer) {
    let value = Connection::open(database_path)
        .and_then(|connection| {
            connection
                .query_row(
                    "SELECT value_json FROM config WHERE key = ?1",
                    [FILE_LOG_LEVEL_CONFIG_KEY],
                    |row| row.get::<_, String>(0),
                )
                .optional()
        })
        .ok()
        .flatten();
    let Some(value) = value else {
        return;
    };
    match serde_json::from_str::<String>(&value)
        .ok()
        .and_then(|level| Level::parse(&level))
    {
        Some(level) => {
            logs.set_file_level(level);
            tracing::info!("applied persisted file log level: {}", level.as_str());
        }
        None => tracing::warn!("ignored invalid persisted file log level: {value}"),
    }
}

/// Resolve and spawn the bundled Gateway through Tauri's platform-aware
/// sidecar API, then forward its event stream into the shared log buffer.
fn spawn_gateway(
    app: &tauri::AppHandle,
    logs: &Arc<LogBuffer>,
    engine_port: u16,
    gateway_port: u16,
    internal_auth_token: &str,
    full_communication_logs: bool,
) -> Option<ServiceHandle> {
    let command = match app.shell().sidecar("encorehub-gateway") {
        Ok(command) => command.envs(gateway_environment(
            engine_port,
            gateway_port,
            internal_auth_token,
            full_communication_logs,
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
    full_communication_logs: bool,
) -> [(String, String); 5] {
    [
        (
            "ENGINE_URL".into(),
            format!("http://127.0.0.1:{engine_port}"),
        ),
        ("LISTEN_ADDR".into(), format!("127.0.0.1:{gateway_port}")),
        ("GIN_MODE".into(), "release".into()),
        (ENGINE_AUTH_TOKEN_ENV.into(), internal_auth_token.into()),
        (
            "ENCOREHUB_FULL_COMMUNICATION_LOGS".into(),
            if full_communication_logs { "1" } else { "0" }.into(),
        ),
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
    fn native_titlebar_rollback_requires_an_explicit_truthy_value() {
        for enabled in ["1", "true", "TRUE", "yes"] {
            assert!(native_titlebar_rollback_value(Some(enabled)));
        }
        for disabled in [None, Some(""), Some("0"), Some("false")] {
            assert!(!native_titlebar_rollback_value(disabled));
        }
    }

    #[test]
    fn gateway_command_receives_internal_token_without_frontend_exposure() {
        const TOKEN: &str = "wf02-desktop-token-canary";
        let env: HashMap<_, _> = gateway_environment(10000, 10001, TOKEN, true)
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
        assert_eq!(
            env.get("ENCOREHUB_FULL_COMMUNICATION_LOGS")
                .map(String::as_str),
            Some("1")
        );

        let ports = serde_json::to_string(&ServicePorts {
            gateway_port: 10001,
        })
        .unwrap();
        assert!(!ports.contains(TOKEN));
        assert!(!ports.contains(ENGINE_AUTH_TOKEN_ENV));
    }

    #[test]
    fn desktop_runtime_creates_daily_log_in_app_data_directory() {
        let temp = tempfile::tempdir().unwrap();
        let app_data = temp.path().join("app-data");
        let resources = temp.path().join("resources");
        let paths = RuntimePaths::prepare(&app_data, &resources).unwrap();
        let logs = LogBuffer::with_log_dir(paths.logs.clone());

        logs.push_event(Source::Desktop, Level::Info, "app-data log initialized");

        let day = chrono::Local::now().format("%Y-%m-%d");
        let file = app_data.join("log").join(format!("encorehub-{day}.log"));
        assert_eq!(paths.logs, app_data.join("log"));
        assert_eq!(paths.database, app_data.join("data/encorehub.db"));
        assert!(file.is_file());
        assert!(std::fs::read_to_string(file)
            .unwrap()
            .contains("app-data log initialized"));
    }

    #[test]
    fn developer_database_connection_is_read_only() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("developer.db");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)",
                [],
            )
            .unwrap();
        connection
            .execute("INSERT INTO sample (value) VALUES ('visible')", [])
            .unwrap();
        drop(connection);

        let read_only = open_developer_database(&path).unwrap();
        let value: String = read_only
            .query_row("SELECT value FROM sample", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "visible");
        assert!(read_only
            .execute("INSERT INTO sample (value) VALUES ('blocked')", [])
            .is_err());
    }

    #[test]
    fn developer_database_connection_registers_sqlite_vec() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("developer.db");
        drop(Connection::open(&path).unwrap());

        let read_only = open_developer_database(&path).unwrap();
        let version: String = read_only
            .query_row("SELECT vec_version()", [], |row| row.get(0))
            .unwrap();
        assert!(!version.is_empty());
    }

    #[test]
    fn database_identifiers_are_quoted_without_becoming_sql() {
        assert_eq!(quoted_identifier("odd\"table"), "\"odd\"\"table\"");
    }
}
