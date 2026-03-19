#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod tor;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::get_tor_status,
            commands::get_app_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GhostChat");
}
