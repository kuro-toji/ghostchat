/**
 * GhostChat — Storage Module
 * 
 * Native SQLite via tauri-plugin-sql:
 *   - Argon2id master key from password (64MB memory-hard)
 *   - Native SQLite (not WASM) with proper file persistence
 *   - Field-level AES-256-GCM encryption for message content
 *   - Memory-only mode: SQLite :memory: — zero disk writes
 *   - Ephemeral message auto-cleanup
 */

// Master Key
export {
  deriveMasterKey,
  verifyAndDerive,
  saltToHex,
  hexToSalt,
  wipeMasterKey,
  type MasterKeyResult,
} from './master-key';

// Database
export {
  initDatabase,
  initMemoryDatabase,
  closeDatabase,
  execute,
  query,
  queryOne,
  isInitialized,
  isMemoryOnly,
  getMasterKey,
} from './database';

// Ephemeral Cleanup
export {
  startEphemeralCleanup,
  stopEphemeralCleanup,
  setMessageExpiration,
  getMessageTimeRemaining,
  onMessagesExpiring,
  onMessagesDeleted,
} from './ephemeral';

// Repository (all async — native SQLite)
export {
  saveContact,
  getContact,
  getAllContacts,
  deleteContact,
  updateLastSeen,
  markVerified,
  saveMessage,
  getMessages,
  getLatestMessages,
  markMessagesRead,
  getUnreadCounts,
  deleteAllMessages,
  getSetting,
  setSetting,
} from './repository';
