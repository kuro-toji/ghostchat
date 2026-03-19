/**
 * GhostChat — Tor Integration (Frontend)
 * 
 * Frontend helpers for Tor integration.
 * Communicates with the Rust Tor controller via Tauri IPC.
 * 
 * Tor mode:
 *   - All connections through SOCKS5:9050
 *   - WebRTC disabled (cannot use SOCKS5)
 *   - Your real IP never exposed to any peer
 *   - Each peer gets separate Tor circuit (IsolateDestAddr)
 *   - .onion address for your node
 */

/** Tor connection state */
export interface TorState {
  active: boolean;
  state: 'inactive' | 'bootstrapping' | 'connected' | 'error';
  bootstrapProgress: number;
  onionAddress: string | null;
  socksPort: number;
  errorMessage: string | null;
}

/** Initial Tor state */
const DEFAULT_TOR_STATE: TorState = {
  active: false,
  state: 'inactive',
  bootstrapProgress: 0,
  onionAddress: null,
  socksPort: 9050,
  errorMessage: null,
};

/** Current Tor state */
let currentState: TorState = { ...DEFAULT_TOR_STATE };

/** State change callbacks */
type TorStateCallback = (state: TorState) => void;
const stateCallbacks: Set<TorStateCallback> = new Set();

/**
 * Start the Tor sidecar via Tauri IPC.
 * Watches for bootstrap progress and .onion address.
 */
export async function startTor(): Promise<TorState> {
  try {
    updateState({
      state: 'bootstrapping',
      bootstrapProgress: 0,
      errorMessage: null,
    });
    
    // Call Rust backend via Tauri
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('start_tor');
    
    // Poll for bootstrap completion
    return await waitForBootstrap();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    updateState({
      active: false,
      state: 'error',
      errorMessage: msg,
    });
    throw err;
  }
}

/**
 * Stop the Tor sidecar.
 */
export async function stopTor(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('stop_tor');
  } catch {
    // Ignore stop errors
  }
  
  updateState({ ...DEFAULT_TOR_STATE });
}

/**
 * Get current Tor status from the backend.
 */
export async function getTorStatus(): Promise<TorState> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const status = await invoke<{
      active: boolean;
      state: string;
      bootstrap_progress: number;
      onion_address: string | null;
      socks_port: number;
    }>('get_tor_status');
    
    updateState({
      active: status.active,
      state: status.state as TorState['state'],
      bootstrapProgress: status.bootstrap_progress,
      onionAddress: status.onion_address,
      socksPort: status.socks_port,
    });
    
    return currentState;
  } catch {
    return currentState;
  }
}

/**
 * Get current Tor state (from cache).
 */
export function getCurrentTorState(): TorState {
  return { ...currentState };
}

/**
 * Check if Tor is active and fully bootstrapped.
 */
export function isTorActive(): boolean {
  return currentState.active && currentState.state === 'connected';
}

/**
 * Get the SOCKS5 proxy address for Tor routing.
 */
export function getTorSocksAddr(): string {
  return `127.0.0.1:${currentState.socksPort}`;
}

/**
 * Get our .onion address.
 */
export function getOnionAddress(): string | null {
  return currentState.onionAddress;
}

/**
 * Register callback for Tor state changes.
 */
export function onTorStateChange(callback: TorStateCallback): () => void {
  stateCallbacks.add(callback);
  return () => stateCallbacks.delete(callback);
}

// ─── Internal ────────────────────────────────────────────────

async function waitForBootstrap(): Promise<TorState> {
  const maxWait = 120000; // 2 minutes max
  const pollInterval = 1000;
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWait) {
    const status = await getTorStatus();
    
    if (status.state === 'connected') {
      updateState({ active: true });
      return currentState;
    }
    
    if (status.state === 'error') {
      throw new Error(status.errorMessage ?? 'Tor bootstrap failed');
    }
    
    await new Promise(r => setTimeout(r, pollInterval));
  }
  
  throw new Error('Tor bootstrap timed out');
}

function updateState(partial: Partial<TorState>): void {
  currentState = { ...currentState, ...partial };
  for (const cb of stateCallbacks) {
    cb({ ...currentState });
  }
}
