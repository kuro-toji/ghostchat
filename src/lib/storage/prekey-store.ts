import { execute, queryOne } from './database';
import { type X25519KeyPair } from '../crypto';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export async function saveX3DHKeys(signedPreKey: X25519KeyPair, oneTimePreKey: X25519KeyPair) {
  const data = JSON.stringify({
    signedPub: bytesToHex(signedPreKey.publicKey),
    signedPriv: bytesToHex(signedPreKey.privateKey),
    oneTimePub: bytesToHex(oneTimePreKey.publicKey),
    oneTimePriv: bytesToHex(oneTimePreKey.privateKey)
  });
  
  await execute('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['x3dh_keys', data]);
}

export async function loadX3DHKeys(): Promise<{ signedPreKeyPair: X25519KeyPair, oneTimePreKeyPair: X25519KeyPair } | null> {
  const row = await queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['x3dh_keys']);
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value);
    return {
      signedPreKeyPair: { publicKey: hexToBytes(parsed.signedPub), privateKey: hexToBytes(parsed.signedPriv) },
      oneTimePreKeyPair: { publicKey: hexToBytes(parsed.oneTimePub), privateKey: hexToBytes(parsed.oneTimePriv) }
    };
  } catch(e) {
    return null;
  }
}
