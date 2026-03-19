# 👻 GhostChat

**Pure P2P Encrypted Messenger — No Servers, No Trace**

Every GhostChat install is a relay + DHT node + peer. The network exists only because users exist.

## Architecture

```
Your App IS a node → DHT → Other peer
No servers. No VPS. No central point.
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Tauri 2.0 (Rust + Web) |
| Frontend | React 18 + TypeScript 5 (strict) |
| Bundler | Vite 5 |
| Styling | Tailwind CSS 3 |
| Animation | Framer Motion 11 |
| State | Zustand 4 |
| Crypto | @noble/curves, @noble/hashes, @noble/ciphers |
| P2P | libp2p (Kademlia DHT, GossipSub, Circuit Relay) |
| Transport | WebRTC + WebSocket (direct), WebSocket (Tor) |
| Database | sql.js (SQLite WASM) + AES-256-GCM encryption |
| Privacy | Tor sidecar, Argon2id, memory-only mode |

## Cryptographic Primitives

| Purpose | Algorithm | Library |
|---------|-----------|---------|
| Identity | Ed25519 | @noble/curves |
| Key Exchange | X25519 ECDH | @noble/curves |
| Key Derivation | HKDF-SHA256 | @noble/hashes |
| Encryption | AES-256-GCM | @noble/ciphers |
| Ratchet | Double Ratchet (custom) | Built-in |
| Handshake | Noise XX | Built-in |
| Password | Argon2id (64MB) | argon2-browser |

## Development

```bash
# Install dependencies
pnpm install

# Run frontend only
pnpm dev

# Run full Tauri app
pnpm tauri dev

# Build for production
pnpm tauri build
```

## Project Structure

```
ghostchat/
├── src/                     # Frontend (React + TypeScript)
│   ├── components/          # UI components
│   │   ├── GhostLogo.tsx    # Animated ghost SVG
│   │   ├── Sidebar.tsx      # Contact list sidebar
│   │   ├── ChatArea.tsx     # Chat messages view
│   │   ├── ChatHeader.tsx   # Conversation header
│   │   ├── MessageBubble.tsx # Message with dissolve animation
│   │   ├── MessageInput.tsx  # Ghost toggle + TTL + send
│   │   ├── StatusBar.tsx    # P2P/Tor/DHT status
│   │   ├── Identicon.tsx    # Deterministic SVG avatars
│   │   ├── ContactItem.tsx  # Contact list entry
│   │   └── *Modal.tsx       # AddContact, Settings, KeyVerification
│   ├── stores/              # Zustand state management
│   ├── hooks/               # React hooks
│   ├── lib/
│   │   ├── crypto/          # Phase 2: Cryptographic core
│   │   │   ├── identity.ts       # Ed25519
│   │   │   ├── key-exchange.ts   # X25519 ECDH
│   │   │   ├── kdf.ts           # HKDF-SHA256
│   │   │   ├── encryption.ts    # AES-256-GCM
│   │   │   ├── double-ratchet.ts # Forward secrecy
│   │   │   ├── noise.ts         # Noise XX handshake
│   │   │   └── safety-numbers.ts # Key verification
│   │   ├── p2p/             # Phase 3-4: Networking
│   │   │   ├── node.ts          # libp2p initialization
│   │   │   ├── peer-discovery.ts # Kademlia DHT
│   │   │   ├── connections.ts   # Dial + retry + heartbeat
│   │   │   ├── protocol.ts     # Wire format
│   │   │   ├── x3dh.ts         # Pre-key bundles
│   │   │   ├── session-manager.ts # Session lifecycle
│   │   │   ├── message-service.ts # Send/receive API
│   │   │   └── ghost-mode.ts   # Ephemeral messaging
│   │   ├── tor/             # Tor frontend integration
│   │   └── storage/         # Phase 5: Encrypted storage
│   │       ├── master-key.ts    # Argon2id
│   │       ├── database.ts     # Encrypted SQLite
│   │       ├── ephemeral.ts    # Cleanup job
│   │       └── repository.ts   # Data access layer
│   ├── types/               # TypeScript interfaces
│   └── utils/               # Utility functions
├── src-tauri/               # Rust backend
│   └── src/
│       ├── main.rs          # Tauri entry
│       ├── tor.rs           # Tor sidecar controller
│       └── commands.rs      # IPC commands
└── package.json
```

## Security Properties

- **Forward secrecy**: Each message key is unique and deleted after use
- **Break-in recovery**: DH ratchet step makes future messages safe even if current keys are compromised
- **No metadata on wire**: Tor hides who is talking to whom
- **Encrypted at rest**: AES-256-GCM encrypted database file
- **Memory-hard passwords**: Argon2id (64MB) resists GPU brute force
- **Safety numbers**: Signal-style 60-digit verification codes

## License

MIT
