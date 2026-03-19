use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// Tor connection state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TorState {
    Inactive,
    Bootstrapping(u8),
    Connected,
    Error(String),
}

/// Tor controller — manages the sidecar tor process
pub struct TorController {
    state: Mutex<TorState>,
    onion_address: Mutex<Option<String>>,
    socks_port: u16,
}

impl TorController {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(TorState::Inactive),
            onion_address: Mutex::new(None),
            socks_port: 9050,
        }
    }

    /// Start Tor sidecar (Phase 3: full implementation)
    pub fn start(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        *state = TorState::Bootstrapping(0);
        Ok(())
    }

    /// Stop Tor process
    pub fn stop(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        *state = TorState::Inactive;
        let mut onion = self.onion_address.lock().map_err(|e| e.to_string())?;
        *onion = None;
        Ok(())
    }

    pub fn get_state(&self) -> TorState {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn get_onion_address(&self) -> Option<String> {
        self.onion_address.lock().ok().and_then(|a| a.clone())
    }

    pub fn get_socks_addr(&self) -> String {
        format!("127.0.0.1:{}", self.socks_port)
    }
}

impl Default for TorController {
    fn default() -> Self {
        Self::new()
    }
}
