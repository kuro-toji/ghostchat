import { createLibp2p } from 'libp2p';
import { noise } from '@libp2p/noise';
import { Yamux } from '@chainsafe/libp2p-yamux';
import { kadDHT } from '@libp2p/kad-dht';
import { identify } from '@libp2p/identify';
import { webSockets } from '@libp2p/websockets';
import { bootstrap } from '@libp2p/bootstrap';
import { ping } from '@libp2p/ping';
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2';

const BOOTSTRAP_PEERS = [
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
];

const GHOSTCHAT_PROTOCOL = '/ghostchat/1.0/message';

async function spawnAgent(agentId: number) {
  const node = await createLibp2p({
    addresses: {
      listen: ['/ip4/0.0.0.0/tcp/0/ws'],
    },
    transports: [
      webSockets(),
      circuitRelayTransport(),
    ],
    connectionEncrypters: [noise() as any],
    streamMuxers: [new Yamux() as any],
    peerDiscovery: [
      bootstrap({ list: BOOTSTRAP_PEERS }),
    ],
    services: {
      dht: kadDHT({
        clientMode: false,
      }),
      identify: identify(),
      ping: ping(),
      relay: circuitRelayServer(),
    },
  });

  await node.start();
  console.log(`[Agent ${agentId}] Started with PeerID: ${node.peerId.toString()}`);

  // Print out listening addresses
  node.getMultiaddrs().forEach((addr) => {
    console.log(`[Agent ${agentId}] Listening on: ${addr.toString()}`);
  });

  // Handle incoming connections for GhostChat protocol
  await node.handle(GHOSTCHAT_PROTOCOL, async ({ stream, connection }) => {
    const sender = connection.remotePeer.toString();
    console.log(`[Agent ${agentId}] Rx Stream on ${GHOSTCHAT_PROTOCOL} from ${sender}`);

    // Read and discard to acknowledge message
    try {
      for await (const _chunk of stream.source) {
        // Discarding encrypted bytes; we're just a network test node
      }
    } catch (e) {
      console.error(`[Agent ${agentId}] Error reading stream:`, e);
    } finally {
      stream.close();
    }
  });

  // Track DHT peer count
  setInterval(() => {
    const peers = node.getPeers().length;
    if (peers > 0) {
      console.log(`[Agent ${agentId}] Connected to ${peers} peers in DHT.`);
    }
  }, 30000);
}

async function main() {
  const args = process.argv.slice(2);
  let count = 1;
  const countArgIndex = args.indexOf('--count');
  if (countArgIndex !== -1 && args.length > countArgIndex + 1) {
    count = parseInt(args[countArgIndex + 1], 10);
  }

  console.log(`Spawning ${count} GhostChat test agents...`);

  for (let i = 1; i <= count; i++) {
    await spawnAgent(i);
  }
}

main().catch(console.error);
