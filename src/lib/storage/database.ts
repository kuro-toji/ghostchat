/**
 * GhostChat — Encrypted Database (tauri-plugin-sql)
 * 
 * REPLACED sql.js WASM with native tauri-plugin-sql for:
 *   ✓ Native SQLite performance (not WASM overhead)
 *   ✓ Proper file persistence (not in-browser memory)
 *   ✓ Immune to OS memory pressure
 *   ✓ Writes to app data directory with proper fsync
 * 
 * Encryption: AES-256-GCM applied at the application layer.
 * The master key is derived from Argon2id and used to encrypt
 * sensitive fields (message content, keys) before storage.
 * 
 * For full-disk encryption, pair with OS-level encryption
 * (FileVault, LUKS, BitLocker).
 * 
 * Memory-only mode: When enabled, uses `:memory:` SQLite database.
 * Nothing touches disk. All data lost on app close. True ghost mode.
 */

/** Database state */
let db: any = null;
let masterKey: Uint8Array | null = null;
let isMemoryMode = false;

/** Whether database is initialized */
export function isInitialized(): boolean {
  return db !== null;
}

/** Whether in memory-only mode */
export function isMemoryOnly(): boolean {
  return isMemoryMode;
}

/**
 * Initialize the database using tauri-plugin-sql.
 * 
 * @param key - 32-byte master key from Argon2id (for field encryption)
 * @param dbName - Database name (default: 'ghostchat.db')
 */
export async function initDatabase(key: Uint8Array, dbName: string = 'ghostchat.db'): Promise<void> {
  masterKey = key;
  isMemoryMode = false;
  
  // Dynamic import tauri-plugin-sql
  const Database = (await import('@tauri-apps/plugin-sql')).default;
  
  // Open native SQLite database (stored in app data dir)
  db = await Database.load(`sqlite:${dbName}`);
  
  // Initialize schema
  await initSchema();
  
  console.log('👻 Database initialized (native SQLite via tauri-plugin-sql)');
}

/**
 * Initialize database in memory-only mode.
 * No file I/O — everything lost on app close. True ghost mode.
 * 
 * This IS implemented — uses SQLite :memory: backend.
 */
export async function initMemoryDatabase(): Promise<void> {
  masterKey = null;
  isMemoryMode = true;
  
  const Database = (await import('@tauri-apps/plugin-sql')).default;
  
  // :memory: = in-RAM SQLite, no disk writes ever
  db = await Database.load('sqlite::memory:');
  
  await initSchema();
  
  console.log('👻 Memory-only database initialized (ghost mode — no disk writes)');
}

/**
 * Close the database.
 */
export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
  
  if (masterKey) {
    masterKey.fill(0);
    masterKey = null;
  }
  
  isMemoryMode = false;
}

/**
 * Execute a SQL statement (INSERT, UPDATE, DELETE).
 */
export async function execute(sql: string, params?: any[]): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  await db.execute(sql, params ?? []);
}

/**
 * Query the database (SELECT).
 */
export async function query<T>(sql: string, params?: any[]): Promise<T[]> {
  if (!db) throw new Error('Database not initialized');
  const result = await db.select(sql, params ?? []);
  return result as T[];
}

/**
 * Query for a single row.
 */
export async function queryOne<T = Record<string, any>>(sql: string, params?: any[]): Promise<T | null> {
  const results = await query<T>(sql, params);
  return results.length > 0 ? results[0] : null;
}

/**
 * Get the master key (for field-level encryption).
 */
export function getMasterKey(): Uint8Array | null {
  return masterKey;
}

// ─── Schema ──────────────────────────────────────────────────

async function initSchema(): Promise<void> {
  if (!db) return;
  
  await db.execute(`
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
  
  await db.execute(`
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
  
  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_peer_id TEXT NOT NULL,
      incoming INTEGER NOT NULL DEFAULT 0,
      content_encrypted BLOB NOT NULL,
      content_nonce BLOB NOT NULL,
      timestamp INTEGER NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0,
      read INTEGER NOT NULL DEFAULT 0,
      ephemeral INTEGER NOT NULL DEFAULT 0,
      ttl INTEGER NOT NULL DEFAULT 0,
      expired_at INTEGER,
      FOREIGN KEY (session_peer_id) REFERENCES contacts(peer_id)
    )
  `);
  
  await db.execute(`
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
  
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  
  // Indexes
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_messages_peer ON messages(session_peer_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_messages_expired ON messages(expired_at)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)`);
  
  console.log('👻 Database schema initialized');
}
