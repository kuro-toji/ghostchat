/**
 * GhostChat — Module 3.4: Protocol Handler (IPC VERSION)
 * 
 * Custom GhostChat messaging protocol over Tauri IPC instead of native webview streams.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../../stores';

/** GhostChat protocol identifier */
export const GHOSTCHAT_PROTOCOL = '/ghostchat/1.0/message';

/** Wire message structure */
export interface WireMessage {
  version: number;
  recipientPeerId: string;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  dhPublicKey: Uint8Array;
  chainIndex: number;
  previousChainLength: number;
  messageType: 'text' | 'key_exchange' | 'system' | 'prekey' | 'x3dh_initial';
}

type MessageCallback = (senderPeerId: string, message: WireMessage) => void;
const messageCallbacks: Set<MessageCallback> = new Set();
let isRegistered = false;

/**
 * Register our protocol handler to listen for Rust IPC events.
 */
export async function registerProtocolHandler(): Promise<void> {
  if (isRegistered) return;
  isRegistered = true;

  await listen<{ from: string; ciphertext: number[] }>('ghostchat://message', (event) => {
    const senderPeerId = event.payload.from;
    const data = new Uint8Array(event.payload.ciphertext);
    
    try {
      const message = deserializeWireMessage(data);
      
      const ourPeerId = useAppStore.getState().ourPeerId;
      if (message.recipientPeerId !== ourPeerId) {
        console.warn(`👻 Message not for us, discarding`);
        return;
      }
      
      for (const cb of messageCallbacks) {
        cb(senderPeerId, message);
      }
    } catch (err) {
      console.error('👻 Protocol handler error:', err);
    }
  });

  console.log(`👻 Protocol handler registered via IPC`);
}

/**
 * Send a wire message to a peer via Rust backend.
 */
export async function sendWireMessage(
  recipientPeerId: string,
  message: WireMessage
): Promise<void> {
  const data = serializeWireMessage(message);
  
  // Tauri invoke expects arrays of numbers for Uint8Array (or native Uint8Array depending on Tauri 2 config)
  await invoke('send_p2p_message', { 
    peerId: recipientPeerId, 
    ciphertext: Array.from(data) 
  });
}

export function onMessage(callback: MessageCallback): () => void {
  messageCallbacks.add(callback);
  return () => messageCallbacks.delete(callback);
}

// ─── Serialization ───────────────────────────────────────────

function serializeWireMessage(msg: WireMessage): Uint8Array {
  const recipientBytes = new TextEncoder().encode(msg.recipientPeerId);
  
  const totalSize = 4 + 4 + recipientBytes.length + 4 + msg.ciphertext.length + 12 + 32 + 4 + 4 + 1;
  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  let offset = 0;
  
  view.setUint32(offset, msg.version, false);
  offset += 4;
  
  view.setUint32(offset, recipientBytes.length, false);
  offset += 4;
  buf.set(recipientBytes, offset);
  offset += recipientBytes.length;
  
  view.setUint32(offset, msg.ciphertext.length, false);
  offset += 4;
  buf.set(msg.ciphertext, offset);
  offset += msg.ciphertext.length;
  
  buf.set(msg.nonce, offset);
  offset += 12;
  
  buf.set(msg.dhPublicKey, offset);
  offset += 32;
  
  view.setUint32(offset, msg.chainIndex, false);
  offset += 4;
  
  view.setUint32(offset, msg.previousChainLength, false);
  offset += 4;
  
  const typeMap: Record<WireMessage['messageType'], number> = { text: 0, key_exchange: 1, system: 2, prekey: 3, x3dh_initial: 4 };
  buf[offset] = typeMap[msg.messageType] ?? 0;
  
  return buf;
}

function deserializeWireMessage(data: Uint8Array): WireMessage {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  
  const version = view.getUint32(offset, false);
  offset += 4;
  
  const recipientLen = view.getUint32(offset, false);
  offset += 4;
  const recipientPeerId = new TextDecoder().decode(data.slice(offset, offset + recipientLen));
  offset += recipientLen;
  
  const ciphertextLen = view.getUint32(offset, false);
  offset += 4;
  const ciphertext = data.slice(offset, offset + ciphertextLen);
  offset += ciphertextLen;
  
  const nonce = data.slice(offset, offset + 12);
  offset += 12;
  
  const dhPublicKey = data.slice(offset, offset + 32);
  offset += 32;
  
  const chainIndex = view.getUint32(offset, false);
  offset += 4;
  
  const previousChainLength = view.getUint32(offset, false);
  offset += 4;
  
  const typeReverseMap: Record<number, WireMessage['messageType']> = {
    0: 'text', 1: 'key_exchange', 2: 'system', 3: 'prekey', 4: 'x3dh_initial',
  };
  const messageType = typeReverseMap[data[offset]] ?? 'text';
  
  return {
    version,
    recipientPeerId,
    ciphertext,
    nonce,
    dhPublicKey,
    chainIndex,
    previousChainLength,
    messageType,
  };
}
