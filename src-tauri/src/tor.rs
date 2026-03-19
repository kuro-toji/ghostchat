// GhostChat — Tor Controller (Full Phase 3 Implementation)
// Manages the Tor sidecar process lifecycle via Tauri shell plugin.
//
// Sidecar:    tor binary bundled per platform
// Args:       --SocksPort 9050 --HiddenServiceDir --HiddenServicePort 4001
// Startup:    watch stdout for "Bootstrapped 100%"
// Onion addr: read from ./tor-hs/hostname after startup
// Shutdown:   kill process on app close
// Stream iso: IsolateDestAddr — each peer gets separate Tor circuit

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::sync::Arc;

/// Tor connection state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TorState {
    Inactive,
    Bootstrapping(u8),
    Connected,
    Error(String),
}

/// Tor status for IPC responses
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorStatus {
    pub active: bool,
    pub state: String,
    pub bootstrap_progress: u8,
    pub onion_address: Option<String>,
    pub socks_port: u16,
}

/// Tor controller manages the sidecar tor process
pub struct TorController {
    state: Arc<Mutex<TorState>>,
    onion_address: Arc<Mutex<Option<String>>>,
    socks_port: u16,
    process_id: Arc<Mutex<Option<u32>>>,
}

impl TorController {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(TorState::Inactive)),
            onion_address: Arc::new(Mutex::new(None)),
            socks_port: 9050,
            process_id: Arc::new(Mutex::new(None)),
        }
    }

    /// Start the Tor sidecar process
    /// Uses Tauri shell plugin to manage the bundled tor binary
    pub async fn start(&self, app_handle: &tauri::AppHandle) -> Result<(), String> {
        {
            let mut state = self.state.lock().map_err(|e| e.to_string())?;
            *state = TorState::Bootstrapping(0);
        }

        // Get app data directory for Tor data
        let app_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;
        
        let tor_hs_dir = app_dir.join("tor-hs");
        let tor_data_dir = app_dir.join("tor-data");

        // Create directories
        std::fs::create_dir_all(&tor_hs_dir)
            .map_err(|e| format!("Failed to create tor-hs dir: {}", e))?;
        std::fs::create_dir_all(&tor_data_dir)
            .map_err(|e| format!("Failed to create tor-data dir: {}", e))?;

        // Launch tor sidecar via shell plugin
        use tauri_plugin_shell::ShellExt;
        
        let sidecar = app_handle
            .shell()
            .sidecar("tor")
            .map_err(|e| format!("Failed to create tor sidecar: {}", e))?
            .args([
                "--SocksPort", &format!("{}", self.socks_port),
                "--HiddenServiceDir", tor_hs_dir.to_str().unwrap_or("./tor-hs"),
                "--HiddenServicePort", &format!("4001 127.0.0.1:4001"),
                "--DataDirectory", tor_data_dir.to_str().unwrap_or("./tor-data"),
            ]);

        let state_clone = self.state.clone();
        let onion_clone = self.onion_address.clone();
        let pid_clone = self.process_id.clone();
        let hs_dir = tor_hs_dir.clone();

        let (mut rx, child) = sidecar
            .spawn()
            .map_err(|e| format!("Failed to spawn tor: {}", e))?;

        // Store process ID
        {
            let mut pid = pid_clone.lock().map_err(|e| e.to_string())?;
            *pid = Some(child.pid());
        }

        // Monitor stdout for bootstrap progress in background
        tokio::spawn(async move {
            use tauri_plugin_shell::process::CommandEvent;
            
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        
                        // Parse bootstrap progress
                        if let Some(progress) = parse_bootstrap_progress(&line_str) {
                            if let Ok(mut state) = state_clone.lock() {
                                *state = if progress >= 100 {
                                    // Read .onion address
                                    if let Ok(hostname) = std::fs::read_to_string(hs_dir.join("hostname")) {
                                        if let Ok(mut onion) = onion_clone.lock() {
                                            *onion = Some(hostname.trim().to_string());
                                        }
                                    }
                                    TorState::Connected
                                } else {
                                    TorState::Bootstrapping(progress as u8)
                                };
                            }
                        }
                    }
                    CommandEvent::Stderr(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        eprintln!("Tor stderr: {}", line_str);
                    }
                    CommandEvent::Error(err) => {
                        eprintln!("Tor error: {}", err);
                        if let Ok(mut state) = state_clone.lock() {
                            *state = TorState::Error(err);
                        }
                    }
                    CommandEvent::Terminated(status) => {
                        eprintln!("Tor terminated with status: {:?}", status);
                        if let Ok(mut state) = state_clone.lock() {
                            match &*state {
                                TorState::Connected => {
                                    *state = TorState::Error("Tor process terminated unexpectedly".to_string());
                                }
                                _ => {
                                    *state = TorState::Inactive;
                                }
                            }
                        }
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    /// Stop the Tor process
    pub fn stop(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        *state = TorState::Inactive;
        
        let mut onion = self.onion_address.lock().map_err(|e| e.to_string())?;
        *onion = None;

        let mut pid = self.process_id.lock().map_err(|e| e.to_string())?;
        *pid = None;

        Ok(())
    }

    /// Get current Tor status for IPC
    pub fn get_status(&self) -> TorStatus {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let onion = self.onion_address.lock().ok().and_then(|a| a.clone());
        
        let (active, state_str, progress) = match &*state {
            TorState::Inactive => (false, "inactive", 0),
            TorState::Bootstrapping(p) => (false, "bootstrapping", *p),
            TorState::Connected => (true, "connected", 100),
            TorState::Error(_) => (false, "error", 0),
        };

        TorStatus {
            active,
            state: state_str.to_string(),
            bootstrap_progress: progress,
            onion_address: onion,
            socks_port: self.socks_port,
        }
    }
}

impl Default for TorController {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse bootstrap progress from Tor stdout
/// Example: "Bootstrapped 45% (loading_descriptors): Loading relay descriptors"
fn parse_bootstrap_progress(line: &str) -> Option<u32> {
    if !line.contains("Bootstrapped") {
        return None;
    }
    
    let after_bootstrapped = line.split("Bootstrapped ").nth(1)?;
    let percentage_str = after_bootstrapped.split('%').next()?;
    percentage_str.trim().parse::<u32>().ok()
}

use tauri::Manager;
