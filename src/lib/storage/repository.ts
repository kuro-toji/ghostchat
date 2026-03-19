/**
 * GhostChat — Contact & Message Repository (async)
 * 
 * Data access layer for contacts and messages.
 * All queries go through tauri-plugin-sql (native SQLite).
 * 
 * Message content is stored encrypted (content_encrypted + content_nonce).
 * Decryption happens at read time using the master key.
 */

import { execute, query, queryOne, getMasterKey } from './database';
import { encrypt, decrypt, type EncryptedPayload } from '../crypto/encryption';
import type { Contact, DecryptedMessage } from '../../types';

// ─── Contacts ────────────────────────────────────────────────

export async function saveContact(contact: Contact): Promise<void> {
  await execute(`
    INSERT OR REPLACE INTO contacts (peer_id, display_name, public_key, added_at, last_seen, is_verified, default_ttl)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    contact.peerId,
    contact.displayName,
    contact.publicKey,
    contact.addedAt,
    contact.lastSeen,
    contact.isVerified ? 1 : 0,
    contact.defaultTtl,
  ]);
}

export async function getContact(peerId: string): Promise<Contact | null> {
  const row = await queryOne<any>(
    'SELECT * FROM contacts WHERE peer_id = ?', [peerId]
  );
  if (!row) return null;
  return rowToContact(row);
}

export async function getAllContacts(): Promise<Contact[]> {
  const rows = await query<any>('SELECT * FROM contacts ORDER BY display_name ASC');
  return rows.map(rowToContact);
}

export async function deleteContact(peerId: string): Promise<void> {
  await execute('DELETE FROM messages WHERE session_peer_id = ?', [peerId]);
  await execute('DELETE FROM sessions WHERE peer_id = ?', [peerId]);
  await execute('DELETE FROM contacts WHERE peer_id = ?', [peerId]);
}

export async function updateLastSeen(peerId: string): Promise<void> {
  await execute('UPDATE contacts SET last_seen = ? WHERE peer_id = ?', [Date.now(), peerId]);
}

export async function markVerified(peerId: string, verified: boolean): Promise<void> {
  await execute('UPDATE contacts SET is_verified = ? WHERE peer_id = ?', [verified ? 1 : 0, peerId]);
}

// ─── Messages (encrypted at rest) ───────────────────────────

export async function saveMessage(msg: DecryptedMessage, peerSessionId: string): Promise<void> {
  const key = getMasterKey();
  
  // Encrypt content before storage
  let contentEncrypted: Uint8Array;
  let contentNonce: Uint8Array;
  
  if (key) {
    const plaintext = new TextEncoder().encode(msg.content);
    const payload = encrypt(plaintext, key);
    contentEncrypted = payload.ciphertext;
    contentNonce = payload.nonce;
  } else {
    // Memory-only mode — no master key, store as-is
    contentEncrypted = new TextEncoder().encode(msg.content);
    contentNonce = new Uint8Array(12);
  }
  
  await execute(`
    INSERT OR REPLACE INTO messages (id, session_peer_id, incoming, content_encrypted, content_nonce, timestamp, delivered, read, ephemeral, ttl, expired_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    msg.id,
    peerSessionId,
    msg.incoming ? 1 : 0,
    Array.from(contentEncrypted),
    Array.from(contentNonce),
    msg.timestamp,
    msg.delivered ? 1 : 0,
    msg.read ? 1 : 0,
    msg.ephemeral ? 1 : 0,
    msg.ttl,
    msg.expiresAt,
  ]);
}

export async function getMessages(
  peerId: string,
  limit: number = 50,
  before?: number
): Promise<DecryptedMessage[]> {
  let sql = 'SELECT * FROM messages WHERE session_peer_id = ?';
  const params: any[] = [peerId];
  
  if (before) {
    sql += ' AND timestamp < ?';
    params.push(before);
  }
  
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);
  
  const rows = await query<any>(sql, params);
  return rows.map(rowToMessage).reverse();
}

export async function getLatestMessages(): Promise<Map<string, DecryptedMessage>> {
  const rows = await query<any>(`
    SELECT m.* FROM messages m
    INNER JOIN (
      SELECT session_peer_id, MAX(timestamp) as max_ts
      FROM messages GROUP BY session_peer_id
    ) latest ON m.session_peer_id = latest.session_peer_id AND m.timestamp = latest.max_ts
  `);
  const result = new Map<string, DecryptedMessage>();
  for (const row of rows) {
    result.set(row.session_peer_id, rowToMessage(row));
  }
  return result;
}

export async function markMessagesRead(peerId: string): Promise<void> {
  await execute(
    'UPDATE messages SET read = 1 WHERE session_peer_id = ? AND incoming = 1 AND read = 0', [peerId]
  );
}

export async function getUnreadCounts(): Promise<Map<string, number>> {
  const rows = await query<{ session_peer_id: string; count: number }>(
    'SELECT session_peer_id, COUNT(*) as count FROM messages WHERE incoming = 1 AND read = 0 GROUP BY session_peer_id'
  );
  const result = new Map<string, number>();
  for (const row of rows) result.set(row.session_peer_id, row.count);
  return result;
}

export async function deleteAllMessages(peerId: string): Promise<void> {
  await execute('DELETE FROM messages WHERE session_peer_id = ?', [peerId]);
}

// ─── Settings ────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const row = await queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

// ─── Row Mappers ─────────────────────────────────────────────

function rowToContact(row: any): Contact {
  return {
    peerId: row.peer_id,
    displayName: row.display_name,
    publicKey: row.public_key,
    addedAt: row.added_at,
    lastSeen: row.last_seen ?? null,
    isVerified: row.is_verified === 1,
    defaultTtl: row.default_ttl,
    online: false,
  };
}

function rowToMessage(row: any): DecryptedMessage {
  const key = getMasterKey();
  let content: string;
  
  if (key && row.content_encrypted) {
    try {
      const payload: EncryptedPayload = {
        ciphertext: new Uint8Array(row.content_encrypted),
        nonce: new Uint8Array(row.content_nonce),
      };
      const plaintext = decrypt(payload, key);
      content = new TextDecoder().decode(plaintext);
    } catch {
      content = '[decryption failed]';
    }
  } else {
    content = new TextDecoder().decode(new Uint8Array(row.content_encrypted || []));
  }
  
  return {
    id: row.id,
    senderPeerId: row.incoming ? row.session_peer_id : 'self',
    content,
    timestamp: row.timestamp,
    incoming: row.incoming === 1,
    delivered: row.delivered === 1,
    read: row.read === 1,
    ephemeral: row.ephemeral === 1,
    ttl: row.ttl,
    expiresAt: row.expired_at ?? null,
  };
}
