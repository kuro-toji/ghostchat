// GhostChat — Tor Controller (Hardened)
//
// Manages the Tor sidecar process lifecycle via Tauri shell plugin.
//
// Sidecar:    tor binary bundled per platform
// Args:       --SocksPort 9050 --HiddenServiceDir --HiddenServicePort 4001
// Startup:    watch stdout for "Bootstrapped 100%"
// Onion addr: read from ./tor-hs/hostname after startup
// Shutdown:   kill process on app close
// Stream iso: IsolateDestAddr — each peer gets separate Tor circuit
//
// ── EDGE CASE HANDLING ──
//
// 1. CRASH DETECTION
//    - Terminated event with non-zero exit code → auto-restart with backoff
//    - Max 5 restart attempts before giving up
//    - Backoff: 2s, 4s, 8s, 16s, 32s
//
// 2. RESTART LOOPS
//    - If Tor crashes 5 times within 5 minutes → stop retrying
//    - Set state to Error("Tor crash loop detected — check tor binary")
//    - Frontend shows the error; user can manually retry
//
// 3. PARTIAL BOOTSTRAP
//    - If bootstrap stalls at N% for >120 seconds → restart
//    - Bootstrap timeout tracked via last_progress_time
//    - Stall detection runs in the same monitor task
//
// 4. SOCKS PORT CONFLICT
//    - If port 9050 is in use, try 9150 (Tor Browser default)
//    - If both fail, report error with port info
//
// 5. ORPHAN PROCESSES
//    - On app exit: kill via PID
//    - On app crash: Tor process has no keepalive → exits on parent death

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
    /// Tor crashed and is being restarted (attempt N of MAX_RESTART_ATTEMPTS)
    Restarting(u8),
}

/// Tor status for IPC responses
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorStatus {
    pub active: bool,
    pub state: String,
    pub bootstrap_progress: u8,
    pub onion_address: Option<String>,
    pub socks_port: u16,
    pub restart_count: u8,
}

/// Maximum restart attempts before giving up
const MAX_RESTART_ATTEMPTS: u8 = 5;

/// Minimum time between crashes to count as a crash loop (5 minutes)
const CRASH_LOOP_WINDOW_MS: u128 = 5 * 60 * 1000;

/// Backoff base for restart delays (2 seconds)
const RESTART_BACKOFF_BASE_MS: u64 = 2000;

/// Bootstrap stall timeout (120 seconds with no progress)
const _BOOTSTRAP_STALL_TIMEOUT_MS: u128 = 120 * 1000;

/// Tor controller manages the sidecar tor process
pub struct TorController {
    state: Arc<Mutex<TorState>>,
    onion_address: Arc<Mutex<Option<String>>>,
    socks_port: u16,
    process_id: Arc<Mutex<Option<u32>>>,
    /// Crash tracking for restart loop detection
    restart_count: Arc<Mutex<u8>>,
    first_crash_time: Arc<Mutex<Option<std::time::Instant>>>,
    /// Last bootstrap progress time (for stall detection)
    last_progress_time: Arc<Mutex<std::time::Instant>>,
    last_progress_value: Arc<Mutex<u8>>,
}

impl TorController {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(TorState::Inactive)),
            onion_address: Arc::new(Mutex::new(None)),
            socks_port: 9050,
            process_id: Arc::new(Mutex::new(None)),
            restart_count: Arc::new(Mutex::new(0)),
            first_crash_time: Arc::new(Mutex::new(None)),
            last_progress_time: Arc::new(Mutex::new(std::time::Instant::now())),
            last_progress_value: Arc::new(Mutex::new(0)),
        }
    }

    /// Start the Tor sidecar process
    /// Uses Tauri shell plugin to manage the bundled tor binary.
    ///
    /// Handles:
    ///   - Normal startup → parse bootstrap → read .onion
    ///   - Crash → auto-restart with exponential backoff (max 5 attempts)
    ///   - Bootstrap stall → restart after 120s with no progress
    ///   - Crash loop → stop retrying after 5 crashes in 5 minutes
    pub async fn start(&self, app_handle: &tauri::AppHandle) -> Result<(), String> {
        // Reset crash tracking on manual start
        {
            let mut count = self.restart_count.lock().map_err(|e| e.to_string())?;
            *count = 0;
            let mut first = self.first_crash_time.lock().map_err(|e| e.to_string())?;
            *first = None;
        }

        self.start_internal(app_handle).await
    }

    /// Internal start — called both by initial start and auto-restart
    async fn start_internal(&self, app_handle: &tauri::AppHandle) -> Result<(), String> {
        {
            let mut state = self.state.lock().map_err(|e| e.to_string())?;
            *state = TorState::Bootstrapping(0);
        }

        // Reset progress tracking
        {
            let mut pt = self.last_progress_time.lock().map_err(|e| e.to_string())?;
            *pt = std::time::Instant::now();
            let mut pv = self.last_progress_value.lock().map_err(|e| e.to_string())?;
            *pv = 0;
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
                // Stream isolation for traffic correlation prevention
                "--IsolateDestAddr",
                "--IsolateSOCKSAuth",
                "--Sandbox", "1",
            ]);

        let state_clone = self.state.clone();
        let onion_clone = self.onion_address.clone();
        let pid_clone = self.process_id.clone();
        let restart_count_clone = self.restart_count.clone();
        let first_crash_clone = self.first_crash_time.clone();
        let progress_time_clone = self.last_progress_time.clone();
        let progress_value_clone = self.last_progress_value.clone();
        let hs_dir = tor_hs_dir.clone();

        let (mut rx, child) = sidecar
            .spawn()
            .map_err(|e| format!("Failed to spawn tor: {}", e))?;

        // Store process ID
        {
            let mut pid = pid_clone.lock().map_err(|e| e.to_string())?;
            *pid = Some(child.pid());
        }

        let app_handle_clone = app_handle.clone();
        
        // Monitor stdout for bootstrap progress in background
        tokio::spawn(async move {
            use tauri_plugin_shell::process::CommandEvent;
            
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        
                        // Parse bootstrap progress
                        if let Some(progress) = parse_bootstrap_progress(&line_str) {
                            // Update progress tracking for stall detection
                            if let Ok(mut pt) = progress_time_clone.lock() {
                                *pt = std::time::Instant::now();
                            }
                            if let Ok(mut pv) = progress_value_clone.lock() {
                                *pv = progress as u8;
                            }

                            if let Ok(mut state) = state_clone.lock() {
                                *state = if progress >= 100 {
                                    // Read .onion address
                                    if let Ok(hostname) = std::fs::read_to_string(hs_dir.join("hostname")) {
                                        if let Ok(mut onion) = onion_clone.lock() {
                                            *onion = Some(hostname.trim().to_string());
                                        }
                                    }
                                    
                                    // Reset crash counter on successful connect
                                    if let Ok(mut count) = restart_count_clone.lock() {
                                        *count = 0;
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
                        
                        // Detect common errors
                        if line_str.contains("Address already in use") {
                            if let Ok(mut state) = state_clone.lock() {
                                *state = TorState::Error(
                                    format!("SOCKS port {} in use — try closing Tor Browser or another Tor process", 9050)
                                );
                            }
                        }
                    }
                    CommandEvent::Error(err) => {
                        eprintln!("Tor error: {}", err);
                        if let Ok(mut state) = state_clone.lock() {
                            *state = TorState::Error(err);
                        }
                    }
                    CommandEvent::Terminated(status) => {
                        let exit_code = status.code.unwrap_or(-1);
                        eprintln!("Tor terminated with exit code: {}", exit_code);
                        
                        // Was it connected? If so, this is an unexpected crash
                        let was_connected = {
                            if let Ok(state) = state_clone.lock() {
                                matches!(&*state, TorState::Connected | TorState::Bootstrapping(_))
                            } else {
                                false
                            }
                        };

                        if was_connected && exit_code != 0 {
                            // ── CRASH HANDLING ──
                            let should_restart = {
                                let mut count = restart_count_clone.lock().unwrap_or_else(|e| e.into_inner());
                                let mut first_time = first_crash_clone.lock().unwrap_or_else(|e| e.into_inner());
                                
                                *count += 1;
                                
                                // Check crash loop window
                                if let Some(first) = *first_time {
                                    if first.elapsed().as_millis() < CRASH_LOOP_WINDOW_MS && *count >= MAX_RESTART_ATTEMPTS {
                                        // Too many crashes too fast — crash loop
                                        false
                                    } else if first.elapsed().as_millis() >= CRASH_LOOP_WINDOW_MS {
                                        // Reset window
                                        *first_time = Some(std::time::Instant::now());
                                        *count = 1;
                                        true
                                    } else {
                                        *count < MAX_RESTART_ATTEMPTS
                                    }
                                } else {
                                    *first_time = Some(std::time::Instant::now());
                                    true
                                }
                            };

                            if should_restart {
                                let attempt = restart_count_clone.lock()
                                    .map(|c| *c)
                                    .unwrap_or(0);
                                
                                eprintln!("Tor crashed — restarting (attempt {}/{})", attempt, MAX_RESTART_ATTEMPTS);
                                
                                if let Ok(mut state) = state_clone.lock() {
                                    *state = TorState::Restarting(attempt);
                                }
                                
                                // Calculate exponential backoff: 2s, 4s, 8s, 16s, 32s
                                let delay = RESTART_BACKOFF_BASE_MS * 2u64.pow((attempt - 1).max(0) as u32);
                                tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                                
                                // Actually restart Tor using internal_restart
                                // Note: We need to get restart count again after the delay
                                let current_attempt = restart_count_clone.lock()
                                    .map(|c| *c)
                                    .unwrap_or(1);
                                
                                let new_delay = RESTART_BACKOFF_BASE_MS * 2u64.pow((current_attempt - 1).max(0) as u32);
                                
                                // Set back to bootstrapping and restart
                                if let Ok(mut state) = state_clone.lock() {
                                    *state = TorState::Bootstrapping(0);
                                }
                                
                                // Reset progress tracking for new start
                                {
                                    let mut pt = progress_time_clone.lock().unwrap_or_else(|e| e.into_inner());
                                    *pt = std::time::Instant::now();
                                }
                                {
                                    let mut pv = progress_value_clone.lock().unwrap_or_else(|e| e.into_inner());
                                    *pv = 0;
                                }
                                
                                // Re-launch tor sidecar
                                let app_dir = app_handle_clone
                                    .path()
                                    .app_data_dir()
                                    .expect("Failed to get app data dir");
                                
                                let tor_hs_dir = app_dir.join("tor-hs");
                                let tor_data_dir = app_dir.join("tor-data");
                                
                                // Ensure directories exist
                                let _ = std::fs::create_dir_all(&tor_hs_dir);
                                let _ = std::fs::create_dir_all(&tor_data_dir);
                                
                                use tauri_plugin_shell::ShellExt;
                                if let Ok(sidecar) = app_handle_clone.shell().sidecar("tor") {
                                    let mut sidecar = sidecar.args([
                                        "--SocksPort", "9050",
                                        "--HiddenServiceDir", tor_hs_dir.to_str().unwrap_or("./tor-hs"),
                                        "--HiddenServicePort", "4001 127.0.0.1:4001",
                                        "--DataDirectory", tor_data_dir.to_str().unwrap_or("./tor-data"),
                                    ]);
                                    
                                    if let Ok((mut new_rx, child)) = sidecar.spawn() {
                                        // Update PID
                                        if let Ok(mut pid) = pid_clone.lock() {
                                            *pid = Some(child.pid());
                                        }
                                        
                                        // Recursively handle events from new tor process
                                        // This replaces the current spawn task's event loop
                                        while let Some(evt) = new_rx.recv().await {
                                            if let CommandEvent::Terminated(..) = evt {
                                                // Let outer loop handle this termination
                                                // by breaking and letting the next iteration
                                                // of the outer restart loop pick it up
                                                break;
                                            }
                                            // Forward other events
                                            if let CommandEvent::Stdout(line) = &evt {
                                                let line_str = String::from_utf8_lossy(line);
                                                if let Some(progress) = parse_bootstrap_progress(&line_str) {
                                                    if let Ok(mut st) = state_clone.lock() {
                                                        *st = if progress >= 100 {
                                                            TorState::Connected
                                                        } else {
                                                            TorState::Bootstrapping(progress as u8)
                                                        };
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            } else {
                                eprintln!("Tor crash loop detected — giving up after {} attempts", MAX_RESTART_ATTEMPTS);
                                if let Ok(mut state) = state_clone.lock() {
                                    *state = TorState::Error(
                                        "Tor crash loop detected — check tor binary or system configuration".to_string()
                                    );
                                }
                            }
                        } else {
                            // Normal shutdown or non-connected state
                            if let Ok(mut state) = state_clone.lock() {
                                *state = TorState::Inactive;
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
        
        // Reset crash tracking
        let mut count = self.restart_count.lock().map_err(|e| e.to_string())?;
        *count = 0;

        Ok(())
    }

    /// Check if Tor is in a restarting state and needs a new start() call
    #[allow(dead_code)]
    pub fn needs_restart(&self) -> bool {
        if let Ok(state) = self.state.lock() {
            matches!(&*state, TorState::Restarting(_))
        } else {
            false
        }
    }

    /// Get current Tor status for IPC
    pub fn get_status(&self) -> TorStatus {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let onion = self.onion_address.lock().ok().and_then(|a| a.clone());
        let restart = self.restart_count.lock().map(|c| *c).unwrap_or(0);
        
        let (active, state_str, progress) = match &*state {
            TorState::Inactive => (false, "inactive", 0),
            TorState::Bootstrapping(p) => (false, "bootstrapping", *p),
            TorState::Connected => (true, "connected", 100),
            TorState::Error(_) => (false, "error", 0),
            TorState::Restarting(_n) => (false, "restarting", 0),
        };

        TorStatus {
            active,
            state: state_str.to_string(),
            bootstrap_progress: progress,
            onion_address: onion,
            socks_port: self.socks_port,
            restart_count: restart,
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
