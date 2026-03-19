#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod tor;

use commands::TorState;
use tor::TorController;
use tokio::sync::Mutex;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(TorState(Mutex::new(TorController::new())))
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::get_tor_status,
            commands::get_app_info,
            commands::start_tor,
            commands::stop_tor,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GhostChat");
}
