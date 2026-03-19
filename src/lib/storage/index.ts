/**
 * GhostChat — Storage Module
 * 
 * Encrypted local storage:
 *   - Argon2id master key from password (64MB memory-hard)
 *   - sql.js SQLite WASM database
 *   - AES-256-GCM whole-file encryption at rest
 *   - Ephemeral message auto-cleanup
 *   - Memory-only ghost mode (no writes)
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
  saveDatabase,
  closeDatabase,
  execute,
  query,
  queryOne,
  isInitialized,
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

// Repository
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
