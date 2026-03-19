// GhostChat — Tauri IPC Commands
// Callable from frontend via invoke()

use serde::{Deserialize, Serialize};
use crate::tor::TorController;
use std::sync::Mutex;
use tauri::State;

/// App info response
#[derive(Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub phase: String,
    pub features: Vec<String>,
}

/// Managed Tor controller state
pub struct TorState(pub Mutex<TorController>);

/// Test command — greet a peer
#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("👻 Hello, {}! Welcome to GhostChat.", name)
}

/// Get Tor connection status
#[tauri::command]
pub fn get_tor_status(tor: State<'_, TorState>) -> crate::tor::TorStatus {
    let controller = tor.0.lock().unwrap();
    controller.get_status()
}

/// Start the Tor sidecar
#[tauri::command]
pub async fn start_tor(
    app: tauri::AppHandle,
    tor: State<'_, TorState>,
) -> Result<(), String> {
    let controller = tor.0.lock().map_err(|e| e.to_string())?;
    controller.start(&app).await
}

/// Stop the Tor sidecar
#[tauri::command]
pub fn stop_tor(tor: State<'_, TorState>) -> Result<(), String> {
    let controller = tor.0.lock().map_err(|e| e.to_string())?;
    controller.stop()
}

/// Get app info
#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "GhostChat".to_string(),
        version: "0.1.0".to_string(),
        phase: "Phase 3 — P2P Networking".to_string(),
        features: vec![
            "Dark ghost theme".to_string(),
            "Ed25519 identity".to_string(),
            "X25519 key exchange".to_string(),
            "AES-256-GCM encryption".to_string(),
            "Double Ratchet protocol".to_string(),
            "Noise XX handshake".to_string(),
            "libp2p networking".to_string(),
            "Kademlia DHT".to_string(),
            "Circuit relay NAT traversal".to_string(),
            "Tor sidecar controller".to_string(),
        ],
    }
}
