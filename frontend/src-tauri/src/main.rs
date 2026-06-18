#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod logs;

use std::io::{BufRead, BufReader};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use serde::Serialize;
use tauri::{Manager, State};

use logs::{LogBuffer, LogEntry, Source};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Windows `CREATE_NO_WINDOW` flag — prevents a console window from popping up
/// when spawning child processes.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A spawned sidecar plus the metadata the developer panel reports.
struct ServiceHandle {
    child: Child,
    pid: u32,
    started: Instant,
}

struct ServiceState {
    engine: Mutex<Option<ServiceHandle>>,
    gateway: Mutex<Option<ServiceHandle>>,
    logs: Arc<LogBuffer>,
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
fn check_engine_health() -> Result<String, String> {
    match ureq::get("http://127.0.0.1:3000/health").call() {
        Ok(r) => r.into_string().map_err(|e| format!("{e}")),
        Err(e) => Err(format!("Engine not ready: {e}")),
    }
}

#[tauri::command]
fn check_gateway_health() -> Result<String, String> {
    match ureq::get("http://127.0.0.1:8080/api/v1/health").call() {
        Ok(r) => r.into_string().map_err(|e| format!("{e}")),
        Err(e) => Err(format!("Gateway not ready: {e}")),
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
        status_of(&state.engine, "engine", 3000),
        status_of(&state.gateway, "gateway", 8080),
    ]
}

fn status_of(slot: &Mutex<Option<ServiceHandle>>, name: &str, port: u16) -> ServiceStatus {
    let mut guard = slot.lock().unwrap();
    match guard.as_mut() {
        // `try_wait` returns Ok(None) while the child is still alive.
        Some(h) => ServiceStatus {
            name: name.into(),
            pid: Some(h.pid),
            running: matches!(h.child.try_wait(), Ok(None)),
            uptime_secs: h.started.elapsed().as_secs(),
            port,
        },
        // Not spawned by us (e.g. dev mode runs sidecars in separate terminals).
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServiceState {
            engine: Mutex::new(None),
            gateway: Mutex::new(None),
            logs: Arc::new(LogBuffer::new()),
        })
        .invoke_handler(tauri::generate_handler![
            check_engine_health,
            check_gateway_health,
            get_service_status,
            get_logs,
            clear_logs,
        ])
        .setup(|app| {
            // Get the directory containing the main executable
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                .unwrap_or_else(|| {
                    app.path().resource_dir()
                        .unwrap_or_else(|_| std::path::PathBuf::from("."))
                });

            eprintln!("EncoreHub starting, resource dir: {:?}", exe_dir);

            let logs = app.state::<ServiceState>().logs.clone();

            // ---- Spawn engine ----
            if let Some(handle) = spawn_service(&exe_dir, "encorehub-engine", &logs) {
                app.state::<ServiceState>()
                    .engine.lock().unwrap()
                    .replace(handle);
            }

            // ---- Spawn gateway ----
            if let Some(handle) = spawn_service(&exe_dir, "gateway", &logs) {
                app.state::<ServiceState>()
                    .gateway.lock().unwrap()
                    .replace(handle);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let engine = {
                    window.state::<ServiceState>()
                        .engine.lock().unwrap().take()
                };
                let gateway = {
                    window.state::<ServiceState>()
                        .gateway.lock().unwrap().take()
                };
                if let Some(mut h) = engine {
                    let _ = h.child.kill();
                    let _ = h.child.wait();
                }
                if let Some(mut h) = gateway {
                    let _ = h.child.kill();
                    let _ = h.child.wait();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running EncoreHub");
}

/// Spawn a bundled sidecar service, suppressing the console window on Windows
/// and draining its stdout/stderr into the shared log buffer so the pipes can
/// never fill up and deadlock the child. Returns the handle on success.
fn spawn_service(dir: &std::path::Path, name: &str, logs: &Arc<LogBuffer>) -> Option<ServiceHandle> {
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
        .stderr(std::process::Stdio::piped());

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
        dir.join("binaries").join(format!("{name}-x86_64-pc-windows-msvc.exe")),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }
    eprintln!("Tried paths: {:?}", candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>());
    None
}
