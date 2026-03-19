/**
 * GhostChat — Chat Store (Zustand)
 * 
 * Chat state: active conversation, messages, message input.
 */

import { create } from 'zustand';
import type { DecryptedMessage } from '../types';

interface ChatState {
  /** Currently active conversation peer ID */
  activePeerId: string | null;
  /** Messages for the active conversation */
  messages: DecryptedMessage[];
  /** Current message input text */
  inputText: string;
  /** Ephemeral mode toggle */
  ephemeralMode: boolean;
  /** Current TTL setting */
  currentTtl: number;
  /** Is the peer typing */
  peerTyping: boolean;
  /** Messages currently dissolving (animation) */
  dissolvingIds: Set<string>;

  // Actions
  setActivePeer: (peerId: string | null) => void;
  setMessages: (messages: DecryptedMessage[]) => void;
  addMessage: (message: DecryptedMessage) => void;
  setInputText: (text: string) => void;
  toggleEphemeral: () => void;
  setCurrentTtl: (ttl: number) => void;
  setPeerTyping: (typing: boolean) => void;
  markDissolving: (ids: string[]) => void;
  removeMessages: (ids: string[]) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activePeerId: null,
  messages: [],
  inputText: '',
  ephemeralMode: false,
  currentTtl: 0,
  peerTyping: false,
  dissolvingIds: new Set(),

  setActivePeer: (peerId) => set({ activePeerId: peerId, messages: [], inputText: '' }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setInputText: (text) => set({ inputText: text }),
  toggleEphemeral: () => set((state) => ({ ephemeralMode: !state.ephemeralMode })),
  setCurrentTtl: (ttl) => set({ currentTtl: ttl }),
  setPeerTyping: (typing) => set({ peerTyping: typing }),
  markDissolving: (ids) =>
    set((state) => {
      const newSet = new Set(state.dissolvingIds);
      ids.forEach((id) => newSet.add(id));
      return { dissolvingIds: newSet };
    }),
  removeMessages: (ids) =>
    set((state) => {
      const newDiss = new Set(state.dissolvingIds);
      ids.forEach((id) => newDiss.delete(id));
      return {
        messages: state.messages.filter((m) => !ids.includes(m.id)),
        dissolvingIds: newDiss,
      };
    }),
}));
