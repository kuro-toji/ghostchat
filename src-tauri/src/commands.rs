use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub phase: String,
    pub features: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct TorStatus {
    pub active: bool,
    pub state: String,
    pub bootstrap_progress: u8,
    pub onion_address: Option<String>,
    pub socks_port: u16,
}

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("👻 Hello, {}! Welcome to GhostChat.", name)
}

#[tauri::command]
pub fn get_tor_status() -> TorStatus {
    TorStatus {
        active: false,
        state: "inactive".to_string(),
        bootstrap_progress: 0,
        onion_address: None,
        socks_port: 9050,
    }
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "GhostChat".to_string(),
        version: "0.1.0".to_string(),
        phase: "Phase 1 — Shell".to_string(),
        features: vec![
            "Dark ghost theme".to_string(),
            "Project structure".to_string(),
            "Tor controller stub".to_string(),
        ],
    }
}
