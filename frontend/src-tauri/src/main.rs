// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

struct ServiceState {
    engine_child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    gateway_child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}

#[tauri::command]
fn check_engine_health() -> Result<String, String> {
    ureq::get("http://127.0.0.1:3000/health")
        .call()
        .map_err(|e| format!("Engine not reachable: {}", e))
        .and_then(|r| r.into_string().map_err(|e| format!("{}", e)))
}

#[tauri::command]
fn check_gateway_health() -> Result<String, String> {
    ureq::get("http://127.0.0.1:8080/api/v1/health")
        .call()
        .map_err(|e| format!("Gateway not reachable: {}", e))
        .and_then(|r| r.into_string().map_err(|e| format!("{}", e)))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .manage(ServiceState {
            engine_child: Mutex::new(None),
            gateway_child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            check_engine_health,
            check_gateway_health,
        ])
        .setup(|app| {
            let shell = app.shell();

            // Spawn engine sidecar
            let engine_cmd = shell.sidecar("encorehub-engine").unwrap();
            let (mut engine_rx, engine_child) = engine_cmd.spawn().expect("Failed to start engine");
            app.state::<ServiceState>()
                .engine_child
                .lock()
                .unwrap()
                .replace(engine_child);

            // Log engine output
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = engine_rx.recv().await {
                    if let CommandEvent::Stdout(line) = event {
                        println!("[engine] {}", String::from_utf8_lossy(&line));
                    }
                }
            });

            // Spawn gateway sidecar
            let gateway_cmd = shell.sidecar("gateway").unwrap();
            let (mut gateway_rx, gateway_child) = gateway_cmd.spawn().expect("Failed to start gateway");
            app.state::<ServiceState>()
                .gateway_child
                .lock()
                .unwrap()
                .replace(gateway_child);

            // Log gateway output
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = gateway_rx.recv().await {
                    if let CommandEvent::Stdout(line) = event {
                        println!("[gateway] {}", String::from_utf8_lossy(&line));
                    }
                }
            });

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
                if let Some(child) = engine {
                    let _ = child.kill();
                }
                if let Some(child) = gateway {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running EncoreHub");
}
