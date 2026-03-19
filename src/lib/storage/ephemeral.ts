/**
 * GhostChat — Ephemeral Message Cleanup
 * 
 * Background job that handles disappearing messages:
 *   - Runs every 5 seconds
 *   - Queries for expired messages
 *   - Triggers dissolve animation in UI → delete from DB
 *   - Memory-only mode: messages never written to DB
 */

import { execute, query, isInitialized } from './database';

/** Cleanup interval (5 seconds) */
const CLEANUP_INTERVAL = 5000;

/** Cleanup timer */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/** Callback for messages about to expire (for dissolve animation) */
type ExpiringCallback = (messageIds: string[]) => void;
const expiringCallbacks: Set<ExpiringCallback> = new Set();

/** Callback for messages that have been deleted */
type DeletedCallback = (messageIds: string[]) => void;
const deletedCallbacks: Set<DeletedCallback> = new Set();

/**
 * Start the ephemeral cleanup job.
 */
export function startEphemeralCleanup(): void {
  stopEphemeralCleanup();
  
  cleanupTimer = setInterval(() => {
    if (!isInitialized()) return;
    
    try {
      processExpiredMessages();
    } catch (err) {
      console.warn('Ephemeral cleanup error:', err);
    }
  }, CLEANUP_INTERVAL);
  
  console.log('👻 Ephemeral cleanup started (every 5s)');
}

/**
 * Stop the cleanup job.
 */
export function stopEphemeralCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * Process expired messages.
 */
async function processExpiredMessages(): Promise<void> {
  const now = Date.now();
  
  const expired = await query<{ id: string }>(
    'SELECT id FROM messages WHERE ephemeral = 1 AND expired_at IS NOT NULL AND expired_at <= ?',
    [now]
  );
  
  if (expired.length === 0) return;
  
  const ids = expired.map(m => m.id);
  
  for (const cb of expiringCallbacks) {
    cb(ids);
  }
  
  setTimeout(() => {
    deleteMessages(ids);
  }, 1100);
}

/**
 * Delete messages from database.
 */
function deleteMessages(ids: string[]): void {
  if (ids.length === 0) return;
  
  const placeholders = ids.map(() => '?').join(',');
  execute(
    `DELETE FROM messages WHERE id IN (${placeholders})`,
    ids
  );
  
  // Notify UI
  for (const cb of deletedCallbacks) {
    cb(ids);
  }
  
  console.log(`👻 Deleted ${ids.length} expired message(s)`);
}

/**
 * Set expiration for an ephemeral message.
 * 
 * @param messageId - Message ID
 * @param ttlMs - Time to live in milliseconds
 */
export function setMessageExpiration(messageId: string, ttlMs: number): void {
  if (ttlMs <= 0) return;
  
  const expiresAt = Date.now() + ttlMs;
  execute(
    'UPDATE messages SET ephemeral = 1, ttl = ?, expired_at = ? WHERE id = ?',
    [ttlMs, expiresAt, messageId]
  );
}

/**
 * Get remaining time for an ephemeral message.
 */
export async function getMessageTimeRemaining(messageId: string): Promise<number | null> {
  const result = await query<{ expired_at: number | null }>(
    'SELECT expired_at FROM messages WHERE id = ?',
    [messageId]
  );
  
  if (result.length === 0 || result[0].expired_at === null) return null;
  
  const remaining = result[0].expired_at - Date.now();
  return remaining > 0 ? remaining : 0;
}

/**
 * Register callback for messages about to expire (for dissolve animation).
 */
export function onMessagesExpiring(callback: ExpiringCallback): () => void {
  expiringCallbacks.add(callback);
  return () => expiringCallbacks.delete(callback);
}

/**
 * Register callback for messages that have been deleted.
 */
export function onMessagesDeleted(callback: DeletedCallback): () => void {
  deletedCallbacks.add(callback);
  return () => deletedCallbacks.delete(callback);
}
