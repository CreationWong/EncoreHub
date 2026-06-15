#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct ServiceState {
    engine_child: Mutex<Option<Child>>,
    gateway_child: Mutex<Option<Child>>,
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServiceState {
            engine_child: Mutex::new(None),
            gateway_child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            check_engine_health,
            check_gateway_health,
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

            // ---- Spawn engine ----
            let engine_path = find_binary(&exe_dir, "encorehub-engine");
            eprintln!("Engine path: {:?}", engine_path);
            if let Some(path) = engine_path {
                match Command::new(&path)
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
                {
                    Ok(child) => {
                        eprintln!("Engine started (pid: {})", child.id());
                        app.state::<ServiceState>()
                            .engine_child.lock().unwrap()
                            .replace(child);
                    }
                    Err(e) => eprintln!("Failed to start engine: {e}"),
                }
            } else {
                eprintln!("Engine binary not found!");
            }

            // ---- Spawn gateway ----
            let gateway_path = find_binary(&exe_dir, "gateway");
            eprintln!("Gateway path: {:?}", gateway_path);
            if let Some(path) = gateway_path {
                match Command::new(&path)
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
                {
                    Ok(child) => {
                        eprintln!("Gateway started (pid: {})", child.id());
                        app.state::<ServiceState>()
                            .gateway_child.lock().unwrap()
                            .replace(child);
                    }
                    Err(e) => eprintln!("Failed to start gateway: {e}"),
                }
            } else {
                eprintln!("Gateway binary not found!");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let engine = {
                    window.state::<ServiceState>()
                        .engine_child.lock().unwrap().take()
                };
                let gateway = {
                    window.state::<ServiceState>()
                        .gateway_child.lock().unwrap().take()
                };
                if let Some(mut child) = engine {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                if let Some(mut child) = gateway {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running EncoreHub");
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
