/**
 * GhostChat — Encrypted SQLite Database
 * 
 * sql.js (SQLite compiled to WASM) with AES-256-GCM encryption at rest.
 * The entire .db file is encrypted/decrypted with the master key.
 * 
 * Stolen hard drive = unreadable without password.
 * 
 * Flow:
 *   1. User enters password → Argon2id → master key
 *   2. Read encrypted .db file from disk (via Tauri fs)
 *   3. AES-256-GCM decrypt → raw SQLite bytes
 *   4. Load into sql.js in memory
 *   5. On save: export → AES-256-GCM encrypt → write to disk
 */

import { encrypt, decrypt, type EncryptedPayload } from '../crypto/encryption';
import { randomBytes } from '@noble/hashes/utils';

/** Database state */
let db: any = null;
let masterKey: Uint8Array | null = null;
let dbPath: string | null = null;

/** Whether database is initialized */
export function isInitialized(): boolean {
  return db !== null;
}

/**
 * Initialize the database.
 * 
 * @param key - 32-byte master key from Argon2id
 * @param path - Path to the encrypted .db file
 */
export async function initDatabase(key: Uint8Array, path: string): Promise<void> {
  masterKey = key;
  dbPath = path;
  
  // Dynamic import sql.js
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  
  // Try to load existing database
  try {
    const { readBinaryFile } = await import('@tauri-apps/plugin-fs');
    const encryptedData = await readBinaryFile(path);
    
    if (encryptedData.length > 0) {
      // Decrypt the database file
      const decryptedBytes = decryptDatabase(new Uint8Array(encryptedData), key);
      db = new SQL.Database(decryptedBytes);
      console.log('👻 Database loaded and decrypted');
    } else {
      db = new SQL.Database();
      console.log('👻 New database created');
    }
  } catch {
    // File doesn't exist yet — create new database
    db = new SQL.Database();
    console.log('👻 New database created');
  }
  
  // Initialize schema
  initSchema();
}

/**
 * Initialize database in memory-only mode.
 * No file I/O — everything lost on app close. True ghost mode.
 */
export async function initMemoryDatabase(): Promise<void> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  
  db = new SQL.Database();
  masterKey = null;
  dbPath = null;
  
  initSchema();
  console.log('👻 Memory-only database initialized (ghost mode)');
}

/**
 * Save the database to disk (encrypted).
 */
export async function saveDatabase(): Promise<void> {
  if (!db || !masterKey || !dbPath) {
    // Memory-only mode or not initialized — nothing to save
    return;
  }
  
  // Export raw SQLite bytes
  const rawBytes = db.export();
  const data = new Uint8Array(rawBytes);
  
  // Encrypt with master key
  const encryptedData = encryptDatabase(data, masterKey);
  
  // Write to disk via Tauri
  try {
    const { writeBinaryFile } = await import('@tauri-apps/plugin-fs');
    await writeBinaryFile(dbPath, encryptedData);
    console.log('👻 Database saved (encrypted)');
  } catch (err) {
    console.error('Failed to save database:', err);
    throw err;
  }
}

/**
 * Close and optionally save the database.
 */
export async function closeDatabase(save: boolean = true): Promise<void> {
  if (save) {
    await saveDatabase();
  }
  
  if (db) {
    db.close();
    db = null;
  }
  
  if (masterKey) {
    masterKey.fill(0);
    masterKey = null;
  }
  
  dbPath = null;
}

/**
 * Execute a SQL statement (INSERT, UPDATE, DELETE).
 */
export function execute(sql: string, params?: any[]): void {
  if (!db) throw new Error('Database not initialized');
  db.run(sql, params);
}

/**
 * Query the database (SELECT).
 */
export function query<T = Record<string, any>>(sql: string, params?: any[]): T[] {
  if (!db) throw new Error('Database not initialized');
  
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  
  return results;
}

/**
 * Query for a single row.
 */
export function queryOne<T = Record<string, any>>(sql: string, params?: any[]): T | null {
  const results = query<T>(sql, params);
  return results.length > 0 ? results[0] : null;
}

// ─── Schema ──────────────────────────────────────────────────

function initSchema(): void {
  if (!db) return;
  
  db.run(`
    CREATE TABLE IF NOT EXISTS contacts (
      peer_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      public_key TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      last_seen INTEGER,
      is_verified INTEGER NOT NULL DEFAULT 0,
      default_ttl INTEGER NOT NULL DEFAULT 0
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      peer_id TEXT PRIMARY KEY,
      root_key BLOB NOT NULL,
      sending_chain_key BLOB NOT NULL,
      receiving_chain_key BLOB NOT NULL,
      our_dh_private BLOB NOT NULL,
      our_dh_public BLOB NOT NULL,
      their_dh_public BLOB NOT NULL,
      sending_index INTEGER NOT NULL DEFAULT 0,
      receiving_index INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_peer_id TEXT NOT NULL,
      incoming INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0,
      read INTEGER NOT NULL DEFAULT 0,
      ephemeral INTEGER NOT NULL DEFAULT 0,
      ttl INTEGER NOT NULL DEFAULT 0,
      expired_at INTEGER,
      FOREIGN KEY (session_peer_id) REFERENCES contacts(peer_id)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS prekey_bundles (
      peer_id TEXT PRIMARY KEY,
      identity_key TEXT NOT NULL,
      signed_prekey_pub TEXT NOT NULL,
      signed_prekey_priv_encrypted BLOB,
      signature TEXT NOT NULL,
      one_time_prekey_pub TEXT,
      one_time_prekey_priv_encrypted BLOB
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  
  // Indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_peer ON messages(session_peer_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_expired ON messages(expired_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)`);
  
  console.log('👻 Database schema initialized');
}

// ─── Encryption helpers ──────────────────────────────────────

/**
 * Encrypt raw database bytes with AES-256-GCM.
 * Format: [12 bytes nonce][n bytes ciphertext+tag]
 */
function encryptDatabase(data: Uint8Array, key: Uint8Array): Uint8Array {
  const payload = encrypt(data, key);
  
  // Pack nonce + ciphertext into single buffer
  const result = new Uint8Array(payload.nonce.length + payload.ciphertext.length);
  result.set(payload.nonce, 0);
  result.set(payload.ciphertext, payload.nonce.length);
  
  return result;
}

/**
 * Decrypt encrypted database bytes.
 */
function decryptDatabase(encryptedData: Uint8Array, key: Uint8Array): Uint8Array {
  // Unpack nonce + ciphertext
  const nonce = encryptedData.slice(0, 12);
  const ciphertext = encryptedData.slice(12);
  
  const payload: EncryptedPayload = { ciphertext, nonce };
  return decrypt(payload, key);
}
