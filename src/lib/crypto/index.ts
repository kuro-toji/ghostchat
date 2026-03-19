/**
 * GhostChat — Cryptographic Core
 * 
 * Six modules providing complete end-to-end encryption:
 *   2.1  Identity       — Ed25519 key generation, signing, verification
 *   2.2  Key Exchange   — X25519 ECDH shared secret derivation
 *   2.3  KDF            — HKDF-SHA256 key derivation
 *   2.4  Encryption     — AES-256-GCM authenticated encryption
 *   2.5  Double Ratchet — Forward secrecy + break-in recovery
 *   2.6  Noise          — Noise XX mutual authentication handshake
 * 
 * Transport-agnostic: works whether Tor is on or off.
 */

// Module 2.1 — Identity
export {
  generateIdentity,
  getPublicKey,
  sign,
  verify,
  signMessage,
  verifyMessage,
  fingerprint,
  publicKeyToHex,
  hexToPublicKey,
  privateKeyToHex,
  hexToPrivateKey,
  type IdentityKeyPair,
  type SignedMessage,
} from './identity';

// Module 2.2 — Key Exchange
export {
  generateX25519KeyPair,
  getX25519PublicKey,
  computeSharedSecret,
  validatePublicKey,
  type X25519KeyPair,
} from './key-exchange';

// Module 2.3 — Key Derivation
export {
  deriveKeys,
  deriveKey,
  kdfRatchet,
  kdfChain,
  kdfX3DH,
  generateSalt,
  type DerivedKeys,
} from './kdf';

// Module 2.4 — Symmetric Encryption
export {
  encrypt,
  decrypt,
  encryptText,
  decryptText,
  wipeKey,
  type EncryptedPayload,
} from './encryption';

// Module 2.5 — Double Ratchet
export {
  initializeAlice,
  initializeBob,
  ratchetEncrypt,
  ratchetDecrypt,
  getSkippedKeyCount,
  type RatchetState,
  type RatchetMessage,
  type MessageHeader,
} from './double-ratchet';

// Module 2.6 — Noise Handshake
export {
  initHandshake,
  createMessage1,
  processMessage1AndCreateMessage2,
  processMessage2AndCreateMessage3,
  processMessage3,
  HandshakePhase,
  type HandshakeState,
  type HandshakeMessage,
  type HandshakeResult,
} from './noise';
