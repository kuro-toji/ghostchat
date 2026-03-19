/**
 * GhostChat — Contact & Message Repository
 * 
 * Data access layer for contacts and messages.
 * All queries go through the encrypted SQLite database.
 */

import { execute, query, queryOne } from './database';
import type { Contact, DecryptedMessage } from '../../types';

// ─── Contacts ────────────────────────────────────────────────

/**
 * Save or update a contact.
 */
export function saveContact(contact: Contact): void {
  execute(`
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

/**
 * Get a contact by PeerID.
 */
export function getContact(peerId: string): Contact | null {
  const row = queryOne<any>(
    'SELECT * FROM contacts WHERE peer_id = ?',
    [peerId]
  );
  
  if (!row) return null;
  return rowToContact(row);
}

/**
 * Get all contacts.
 */
export function getAllContacts(): Contact[] {
  const rows = query<any>('SELECT * FROM contacts ORDER BY display_name ASC');
  return rows.map(rowToContact);
}

/**
 * Delete a contact and all their messages.
 */
export function deleteContact(peerId: string): void {
  execute('DELETE FROM messages WHERE session_peer_id = ?', [peerId]);
  execute('DELETE FROM sessions WHERE peer_id = ?', [peerId]);
  execute('DELETE FROM contacts WHERE peer_id = ?', [peerId]);
}

/**
 * Update last seen timestamp.
 */
export function updateLastSeen(peerId: string): void {
  execute('UPDATE contacts SET last_seen = ? WHERE peer_id = ?', [Date.now(), peerId]);
}

/**
 * Mark contact as verified (safety numbers confirmed).
 */
export function markVerified(peerId: string, verified: boolean): void {
  execute('UPDATE contacts SET is_verified = ? WHERE peer_id = ?', [verified ? 1 : 0, peerId]);
}

// ─── Messages ────────────────────────────────────────────────

/**
 * Save a message.
 */
export function saveMessage(msg: DecryptedMessage, peerSessionId: string): void {
  execute(`
    INSERT OR REPLACE INTO messages (id, session_peer_id, incoming, content, timestamp, delivered, read, ephemeral, ttl, expired_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    msg.id,
    peerSessionId,
    msg.incoming ? 1 : 0,
    msg.content,
    msg.timestamp,
    msg.delivered ? 1 : 0,
    msg.read ? 1 : 0,
    msg.ephemeral ? 1 : 0,
    msg.ttl,
    msg.expiresAt,
  ]);
}

/**
 * Get messages for a conversation. 
 * 
 * @param peerId - Peer's PeerID
 * @param limit - Max messages to return (default 50)
 * @param before - Timestamp before which to get messages
 */
export function getMessages(
  peerId: string,
  limit: number = 50,
  before?: number
): DecryptedMessage[] {
  let sql = 'SELECT * FROM messages WHERE session_peer_id = ?';
  const params: any[] = [peerId];
  
  if (before) {
    sql += ' AND timestamp < ?';
    params.push(before);
  }
  
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);
  
  const rows = query<any>(sql, params);
  return rows.map(rowToMessage).reverse();
}

/**
 * Get the latest message for each conversation (for sidebar).
 */
export function getLatestMessages(): Map<string, DecryptedMessage> {
  const rows = query<any>(`
    SELECT m.* FROM messages m
    INNER JOIN (
      SELECT session_peer_id, MAX(timestamp) as max_ts
      FROM messages
      GROUP BY session_peer_id
    ) latest ON m.session_peer_id = latest.session_peer_id AND m.timestamp = latest.max_ts
  `);
  
  const result = new Map<string, DecryptedMessage>();
  for (const row of rows) {
    result.set(row.session_peer_id, rowToMessage(row));
  }
  return result;
}

/**
 * Mark messages as read.
 */
export function markMessagesRead(peerId: string): void {
  execute(
    'UPDATE messages SET read = 1 WHERE session_peer_id = ? AND incoming = 1 AND read = 0',
    [peerId]
  );
}

/**
 * Get unread message count per peer.
 */
export function getUnreadCounts(): Map<string, number> {
  const rows = query<{ session_peer_id: string; count: number }>(
    'SELECT session_peer_id, COUNT(*) as count FROM messages WHERE incoming = 1 AND read = 0 GROUP BY session_peer_id'
  );
  
  const result = new Map<string, number>();
  for (const row of rows) {
    result.set(row.session_peer_id, row.count);
  }
  return result;
}

/**
 * Delete all messages for a peer.
 */
export function deleteAllMessages(peerId: string): void {
  execute('DELETE FROM messages WHERE session_peer_id = ?', [peerId]);
}

// ─── Settings ────────────────────────────────────────────────

/**
 * Get a setting value.
 */
export function getSetting(key: string): string | null {
  const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

/**
 * Set a setting value.
 */
export function setSetting(key: string, value: string): void {
  execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
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
  return {
    id: row.id,
    senderPeerId: row.incoming ? row.session_peer_id : 'self',
    content: row.content,
    timestamp: row.timestamp,
    incoming: row.incoming === 1,
    delivered: row.delivered === 1,
    read: row.read === 1,
    ephemeral: row.ephemeral === 1,
    ttl: row.ttl,
    expiresAt: row.expired_at ?? null,
  };
}
