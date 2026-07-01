#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod log_layer;
mod logs;

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use serde::Serialize;
use tauri::{Manager, State};
use tracing_subscriber::{fmt, prelude::*, reload, EnvFilter};

use encorehub_engine::logging::{normalize_level, LogControl};
use encorehub_engine::{find_free_port, Database, SkillRegistry};
use log_layer::LogBufferLayer;
use logs::{LogBuffer, LogEntry, Source};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Windows `CREATE_NO_WINDOW` flag — prevents a console window from popping up
/// when spawning child processes.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Default starting port for auto-negotiation in Tauri / client mode.
const CLIENT_PORT_START: u16 = 10000;

/// A spawned sidecar plus the metadata the developer panel reports.
struct ServiceHandle {
    child: Child,
    pid: u32,
    started: Instant,
}

struct ServiceState {
    /// The engine now runs in-process (an axum task on Tauri's tokio runtime),
    /// so there is no child handle — just the start time for the uptime readout.
    engine_started: Instant,
    gateway: Mutex<Option<ServiceHandle>>,
    logs: Arc<LogBuffer>,
    /// Dynamically negotiated ports (filled during setup).
    engine_port: u16,
    gateway_port: u16,
}

/// Port info returned to the frontend so it can build API URLs.
#[derive(Serialize, Clone, Copy)]
struct ServicePorts {
    engine_port: u16,
    gateway_port: u16,
}

/// Status snapshot for one process, surfaced to the developer panel.
#[derive(Serialize)]
struct ServiceStatus {
    name: String,
    pid: Option<u32>,
    /// Whether the child is still alive (best-effort, via `try_wait`). The
    /// desktop process reports itself as always running.
    running: bool,
    uptime_secs: u64,
    /// Loopback port the service listens on (0 = the desktop app itself).
    port: u16,
}

#[tauri::command]
fn check_engine_health(state: State<ServiceState>) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{}/health", state.engine_port);
    match ureq::get(&url).call() {
        Ok(r) => r.into_string().map_err(|e| format!("{e}")),
        Err(e) => Err(format!("Engine not ready: {e}")),
    }
}

#[tauri::command]
fn check_gateway_health(state: State<ServiceState>) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{}/api/v1/health", state.gateway_port);
    match ureq::get(&url).call() {
        Ok(r) => r.into_string().map_err(|e| format!("{e}")),
        Err(e) => Err(format!("Gateway not ready: {e}")),
    }
}

/// Return the negotiated ports so the frontend can construct API URLs.
#[tauri::command]
fn get_service_ports(state: State<ServiceState>) -> ServicePorts {
    ServicePorts {
        engine_port: state.engine_port,
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
    let mut guard = slot.lock().unwrap();
    match guard.as_mut() {
        Some(h) => ServiceStatus {
            name: name.into(),
            pid: Some(h.pid),
            running: matches!(h.child.try_wait(), Ok(None)),
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

/// Open the webview's native DevTools (inspector). Available in release builds
/// because the `devtools` Cargo feature is enabled; without it this method
/// would only exist in debug builds.
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

fn main() {
    // Resolve the directory containing the executable. The engine's data dir,
    // skills, and the log mirror all live alongside it (e.g.
    // %LOCALAPPDATA%\EncoreHub\). Computed up front so the shared LogBuffer can
    // mirror lines to disk from the start.
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    let logs = Arc::new(LogBuffer::with_log_dir(exe_dir.join("log")));

    // Install a global tracing subscriber so the in-process engine's events flow
    // into the developer-panel buffer (and the terminal, for `pnpm tauri dev`).
    // A reload layer lets `/api/config/log_level` switch levels at runtime, the
    // same as the standalone binary. The initial level comes from RUST_LOG; the
    // value persisted in the DB is applied once the DB is opened in `setup`.
    let initial_filter =
        EnvFilter::new(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()));
    let (filter_layer, reload_handle) = reload::Layer::new(initial_filter);
    tracing_subscriber::registry()
        .with(filter_layer)
        .with(fmt::layer().with_target(false))
        .with(LogBufferLayer::new(logs.clone()))
        .init();

    let log_control = LogControl::new(move |level| {
        let directive =
            normalize_level(level).ok_or_else(|| format!("invalid log level: {level}"))?;
        reload_handle
            .reload(EnvFilter::new(directive))
            .map_err(|e| e.to_string())
    });

    // --- port negotiation (client / Tauri mode) ---
    // ENGINE_BIND / LISTEN_ADDR env vars override auto-negotiation so developers
    // and headless deployments keep predictable ports.  When unset we scan from
    // CLIENT_PORT_START, finding two adjacent free ports (engine then gateway).
    let engine_port: u16 = std::env::var("ENGINE_BIND")
        .ok()
        .and_then(|v| v.rsplit(':').next()?.parse().ok())
        .unwrap_or_else(|| find_free_port(CLIENT_PORT_START));
    let gateway_port: u16 = std::env::var("LISTEN_ADDR")
        .ok()
        .and_then(|v| v.rsplit(':').next()?.parse().ok())
        .unwrap_or_else(|| find_free_port(engine_port + 1));

    tracing::info!(
        "negotiated ports: engine={engine_port} gateway={gateway_port}"
    );

    // `setup` consumes these once; an Option lets us `take()` inside the FnMut.
    let mut startup = Some((exe_dir.clone(), log_control, engine_port, gateway_port));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServiceState {
            engine_started: Instant::now(),
            gateway: Mutex::new(None),
            logs: logs.clone(),
            engine_port,
            gateway_port,
        })
        .invoke_handler(tauri::generate_handler![
            check_engine_health,
            check_gateway_health,
            get_service_ports,
            get_service_status,
            get_logs,
            clear_logs,
            open_devtools,
        ])
        .setup(move |app| {
            let (exe_dir, log_control, engine_port, gateway_port) =
                startup.take().expect("setup runs once");
            eprintln!("EncoreHub starting, exe dir: {:?}", exe_dir);
            eprintln!("Ports: engine={engine_port} gateway={gateway_port}");

            let logs = app.state::<ServiceState>().logs.clone();

            // ---- Start engine in-process ----
            start_engine(app, &exe_dir, log_control, engine_port);

            // ---- Spawn gateway (still a sidecar) ----
            if let Some(handle) = spawn_service(&exe_dir, "gateway", &logs, engine_port, gateway_port) {
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
                if let Some(mut h) = gateway {
                    let _ = h.child.kill();
                    let _ = h.child.wait();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running EncoreHub");
}

/// Open the engine's database + skills and start its axum service on Tauri's
/// tokio runtime. Replaces the old `spawn_service(.., "encorehub-engine", ..)`
/// path — the engine is now a library task in this process, not a sidecar exe.
fn start_engine(
    app: &tauri::App,
    exe_dir: &std::path::Path,
    log_control: LogControl,
    port: u16,
) {
    let db_path = std::env::var("ENGINE_DB")
        .map(PathBuf::from)
        .unwrap_or_else(|_| exe_dir.join("data").join("encorehub.db"));
    let skills_dir = std::env::var("ENCOREHUB_SKILLS_DIR")
        .map(PathBuf::from)
        .or_else(|_| app.path().resource_dir().map(|d| d.join("skills")))
        .unwrap_or_else(|_| exe_dir.join("skills"));

    let db = match Database::open_and_return(&db_path) {
        Ok(db) => db,
        Err(e) => {
            tracing::error!("failed to open engine database at {db_path:?}: {e}");
            return;
        }
    };

    if let Ok(Some(entry)) = db.get_config("log_level") {
        if let Ok(level) = serde_json::from_str::<String>(&entry.value_json) {
            let _ = log_control.set(&level);
        }
    }

    let skill_registry = SkillRegistry::load(&skills_dir);
    tracing::info!("Skills loaded: {} total", skill_registry.list().len());

    let bind_addr = format!("127.0.0.1:{port}");
    tracing::info!("Engine starting in-process on http://{bind_addr}");

    tauri::async_runtime::spawn(async move {
        if let Err(e) =
            encorehub_engine::serve(db, skill_registry, Some(log_control), bind_addr).await
        {
            tracing::error!("engine serve exited: {e}");
        }
    });
}

/// Spawn a bundled sidecar service, suppressing the console window on Windows
/// and draining its stdout/stderr into the shared log buffer so the pipes can
/// never fill up and deadlock the child. Returns the handle on success.
fn spawn_service(
    dir: &std::path::Path,
    name: &str,
    logs: &Arc<LogBuffer>,
    engine_port: u16,
    gateway_port: u16,
) -> Option<ServiceHandle> {
    let path = match find_binary(dir, name) {
        Some(p) => p,
        None => {
            eprintln!("{name} binary not found!");
            return None;
        }
    };
    eprintln!("{name} path: {path:?}");

    let mut cmd = Command::new(&path);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .env("ENGINE_URL", format!("http://127.0.0.1:{engine_port}"))
        .env("LISTEN_ADDR", format!("127.0.0.1:{gateway_port}"));

    // Windows: don't flash a console window for the sidecar.
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.spawn() {
        Ok(mut child) => {
            let pid = child.id();
            eprintln!("{name} started (pid: {pid})");
            let source = Source::from_service(name);
            if let Some(stdout) = child.stdout.take() {
                drain(source, "out", stdout, logs.clone());
            }
            if let Some(stderr) = child.stderr.take() {
                drain(source, "err", stderr, logs.clone());
            }
            Some(ServiceHandle {
                child,
                pid,
                started: Instant::now(),
            })
        }
        Err(e) => {
            eprintln!("Failed to start {name}: {e}");
            None
        }
    }
}

/// Continuously read a child stream line-by-line on a dedicated thread so the
/// pipe buffer never blocks the child. Each line is redacted and appended to
/// the shared log buffer (and echoed to our stderr for terminal-based dev).
fn drain<R: std::io::Read + Send + 'static>(
    source: Source,
    stream: &'static str,
    reader: R,
    logs: Arc<LogBuffer>,
) {
    thread::spawn(move || {
        let mut lines = BufReader::new(reader).lines();
        while let Some(Ok(line)) = lines.next() {
            eprintln!("[{source:?}/{stream}] {line}");
            logs.push(source, stream, &line);
        }
    });
}

/// Find a binary in the given directory, trying multiple naming conventions.
fn find_binary(dir: &std::path::Path, name: &str) -> Option<std::path::PathBuf> {
    let candidates = vec![
        dir.join(format!("{name}.exe")),
        dir.join("binaries").join(format!("{name}.exe")),
        dir.join(format!("{name}-x86_64-pc-windows-msvc.exe")),
        dir.join("binaries")
            .join(format!("{name}-x86_64-pc-windows-msvc.exe")),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }
    eprintln!(
        "Tried paths: {:?}",
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
    );
    None
}
