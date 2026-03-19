/**
 * GhostChat — Ghost Mode (Ephemeral Messaging)
 * 
 * Full ephemeral messaging system:
 *   - Per-message TTL with ghost toggle
 *   - Per-contact default TTL
 *   - Memory-only mode (no DB writes ever)
 *   - Dissolve animation sequencing
 *   - Read-triggered expiration (starts countdown when message is read)
 */

import type { DecryptedMessage } from '../../types';
import { TTL_PRESETS } from '../../types';

/** Ghost mode configuration per contact */
export interface GhostConfig {
  /** Whether ghost mode is enabled */
  enabled: boolean;
  /** TTL in milliseconds (0 = permanent) */
  ttl: number;
  /** Start timer on send (true) or on read (false) */
  timerStartsOnSend: boolean;
}

/** Default ghost config */
export const DEFAULT_GHOST_CONFIG: GhostConfig = {
  enabled: false,
  ttl: TTL_PRESETS.FIVE_MINUTES,
  timerStartsOnSend: true,
};

/** Active dissolve timers */
const dissolveTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Apply ghost mode to a message before sending.
 * Sets TTL and ephemeral flags.
 */
export function applyGhostMode(
  message: Partial<DecryptedMessage>,
  config: GhostConfig
): Partial<DecryptedMessage> {
  if (!config.enabled) {
    return { ...message, ephemeral: false, ttl: 0, expiresAt: null };
  }
  
  const expiresAt = config.timerStartsOnSend
    ? Date.now() + config.ttl
    : null; // Set on read
  
  return {
    ...message,
    ephemeral: true,
    ttl: config.ttl,
    expiresAt,
  };
}

/**
 * Start dissolve timer for an ephemeral message.
 * When timer expires, marks the message for dissolve animation.
 */
export function startDissolveTimer(
  messageId: string,
  ttlMs: number,
  onDissolve: (id: string) => void
): void {
  // Cancel existing timer if any
  cancelDissolveTimer(messageId);
  
  const timer = setTimeout(() => {
    onDissolve(messageId);
    dissolveTimers.delete(messageId);
  }, ttlMs);
  
  dissolveTimers.set(messageId, timer);
}

/**
 * Cancel a dissolve timer.
 */
export function cancelDissolveTimer(messageId: string): void {
  const timer = dissolveTimers.get(messageId);
  if (timer) {
    clearTimeout(timer);
    dissolveTimers.delete(messageId);
  }
}

/**
 * Cancel all dissolve timers.
 */
export function cancelAllDissolveTimers(): void {
  for (const timer of dissolveTimers.values()) {
    clearTimeout(timer);
  }
  dissolveTimers.clear();
}

/**
 * Trigger read-based expiration.
 * Called when a ghost message is first displayed on screen.
 */
export function triggerReadExpiration(
  messageId: string,
  ttlMs: number,
  onDissolve: (id: string) => void
): void {
  startDissolveTimer(messageId, ttlMs, onDissolve);
}

/**
 * Get the available TTL presets for UI.
 */
export function getTtlPresets(): Array<{ label: string; value: number }> {
  return [
    { label: 'Off', value: TTL_PRESETS.PERMANENT },
    { label: '5s', value: TTL_PRESETS.FIVE_SECONDS },
    { label: '1m', value: TTL_PRESETS.ONE_MINUTE },
    { label: '5m', value: TTL_PRESETS.FIVE_MINUTES },
    { label: '1h', value: TTL_PRESETS.ONE_HOUR },
    { label: '24h', value: TTL_PRESETS.TWENTY_FOUR_HOURS },
  ];
}

/**
 * Format TTL for display.
 */
export function formatTtl(ms: number): string {
  if (ms === 0) return 'Permanent';
  if (ms < 60000) return `${ms / 1000}s`;
  if (ms < 3600000) return `${ms / 60000}m`;
  if (ms < 86400000) return `${ms / 3600000}h`;
  return `${ms / 86400000}d`;
}
