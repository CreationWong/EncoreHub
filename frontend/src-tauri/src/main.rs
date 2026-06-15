// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

#[tauri::command]
fn check_engine_health() -> Result<String, String> {
    let resp = ureq::get("http://127.0.0.1:3000/health")
        .call()
        .map_err(|e| format!("Engine not reachable: {}", e))?;
    resp.into_string()
        .map_err(|e| format!("Failed to read response: {}", e))
}

#[tauri::command]
fn check_gateway_health() -> Result<String, String> {
    let resp = ureq::get("http://127.0.0.1:8080/api/v1/health")
        .call()
        .map_err(|e| format!("Gateway not reachable: {}", e))?;
    resp.into_string()
        .map_err(|e| format!("Failed to read response: {}", e))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        // .plugin(tauri_plugin_global_shortcut::init()) // API differs; enable later
        .invoke_handler(tauri::generate_handler![
            check_engine_health,
            check_gateway_health,
        ])
        .setup(|app| {
            let _window = app.get_webview_window("main").unwrap();

            // Open DevTools in debug mode
            #[cfg(debug_assertions)]
            {
                window.open_devtools();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running EncoreHub");
}
