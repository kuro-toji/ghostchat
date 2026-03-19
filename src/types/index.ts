/**
 * GhostChat — Core Type Definitions
 * 
 * All shared interfaces for messages, sessions, contacts, and pre-key bundles.
 */

// ─── Messages ────────────────────────────────────────────────

/** GhostMessage — the core message structure */
export interface GhostMessage {
  /** UUID v4 message identifier */
  id: string;
  /** Sender's Ed25519 public key (32 bytes hex) */
  sender: string;
  /** Recipient's Ed25519 public key (32 bytes hex) */
  recipient: string;
  /** AES-256-GCM encrypted ciphertext */
  ciphertext: Uint8Array;
  /** 12-byte GCM nonce */
  nonce: Uint8Array;
  /** Sender's current X25519 DH public key (ratchet state) */
  dhPublicKey: Uint8Array;
  /** Position in Double Ratchet chain */
  chainIndex: number;
  /** Previous chain length (for skipped key handling) */
  previousChainLength: number;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Message content type */
  messageType: MessageType;
  /** Ephemeral (disappearing) message flag */
  ephemeral: boolean;
  /** Time-to-live in milliseconds (0 = permanent) */
  ttl: number;
}

/** Message content types */
export type MessageType = 'text' | 'key_exchange' | 'system' | 'prekey';

/** Decrypted message for UI display */
export interface DecryptedMessage {
  id: string;
  senderPeerId: string;
  content: string;
  timestamp: number;
  incoming: boolean;
  delivered: boolean;
  read: boolean;
  ephemeral: boolean;
  ttl: number;
  /** When this message expires (timestamp), null if permanent */
  expiresAt: number | null;
}

/** TTL presets in milliseconds */
export const TTL_PRESETS = {
  PERMANENT: 0,
  FIVE_SECONDS: 5 * 1000,
  ONE_MINUTE: 60 * 1000,
  FIVE_MINUTES: 5 * 60 * 1000,
  ONE_HOUR: 60 * 60 * 1000,
  TWENTY_FOUR_HOURS: 24 * 60 * 60 * 1000,
} as const;

// ─── Sessions ────────────────────────────────────────────────

/** Session state for a conversation with a peer */
export interface Session {
  /** Peer's PeerID string */
  peerId: string;
  /** Session creation timestamp */
  createdAt: number;
  /** Last activity timestamp */
  updatedAt: number;
  /** Whether the session has completed initial handshake */
  established: boolean;
  /** Default ephemeral setting for this session */
  ephemeralDefault: boolean;
  /** Default TTL for messages in this session */
  defaultTtl: number;
}

/** Session status */
export type SessionStatus = 'initializing' | 'handshaking' | 'active' | 'closed';

// ─── Contacts ────────────────────────────────────────────────

/** Contact entry */
export interface Contact {
  /** Peer's PeerID string */
  peerId: string;
  /** Display name (user-chosen) */
  displayName: string;
  /** Peer's Ed25519 public key (hex) */
  publicKey: string;
  /** When the contact was added */
  addedAt: number;
  /** Last time the contact was seen online */
  lastSeen: number | null;
  /** Whether identity has been verified via safety numbers */
  isVerified: boolean;
  /** Default TTL for this contact's messages */
  defaultTtl: number;
  /** Online status */
  online: boolean;
}

// ─── Pre-Key Bundles ─────────────────────────────────────────

/** X3DH Pre-Key Bundle — published to DHT for offline messaging */
export interface PreKeyBundle {
  /** Owner's Ed25519 identity public key */
  identityKey: Uint8Array;
  /** Signed pre-key (X25519 public key) */
  signedPreKeyPub: Uint8Array;
  /** Signature over the signed pre-key (Ed25519) */
  signedPreKeySignature: Uint8Array;
  /** One-time pre-key (X25519 public key), optional */
  oneTimePreKeyPub: Uint8Array | null;
  /** Timestamp when bundle was created */
  timestamp: number;
}

/** Serialized pre-key bundle for DHT storage */
export interface SerializedPreKeyBundle {
  identityKey: string;       // hex
  signedPreKeyPub: string;   // hex
  signature: string;         // hex
  oneTimePreKeyPub: string | null; // hex
  timestamp: number;
}

// ─── App Settings ────────────────────────────────────────────

/** Application settings */
export interface AppSettings {
  /** Enable Tor by default */
  torEnabled: boolean;
  /** Default message TTL */
  defaultTtl: number;
  /** Memory-only mode — no DB writes */
  memoryOnlyMode: boolean;
  /** Theme (future: light/dark/custom) */
  theme: 'dark';
}

/** Default settings */
export const DEFAULT_SETTINGS: AppSettings = {
  torEnabled: true,
  defaultTtl: 0,
  memoryOnlyMode: false,
  theme: 'dark',
};
