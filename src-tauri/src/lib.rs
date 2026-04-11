#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod tor;
mod p2p;
mod network_probe;
// key_rotation is dead code — Double Ratchet is implemented in TypeScript
// mod key_rotation;

use commands::TorState;
use tor::TorController;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    #[cfg(any(windows, target_os = "macos"))]
                    let _ = window.set_prevent_capture(true);
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(TorState(Mutex::new(TorController::new())))
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::get_tor_status,
            commands::get_app_info,
            commands::start_tor,
            commands::stop_tor,
            commands::get_master_key,
            commands::save_master_key,
            commands::get_network_capabilities,
            p2p::start_p2p_node,
            p2p::stop_p2p_node,
            p2p::discover_peers,
            p2p::dht_put,
            p2p::dht_get,
            p2p::send_p2p_message,
            p2p::dial_peer,
            p2p::get_connected_peers,
            p2p::get_listen_addrs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GhostChat");
}
