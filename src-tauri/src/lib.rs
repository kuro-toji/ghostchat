#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod tor;

use commands::TorState;
use tor::TorController;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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
