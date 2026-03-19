/**
 * GhostChat — App Store (Zustand)
 * 
 * Global application state: Tor status, node status, current view, modals.
 */

import { create } from 'zustand';

export type ModalType = 'add-contact' | 'settings' | 'key-verification' | null;
export type AppView = 'chat' | 'settings' | 'onboarding';

interface AppState {
  /** Tor connection status */
  torStatus: 'inactive' | 'bootstrapping' | 'connected' | 'error';
  torProgress: number;
  /** P2P node status */
  nodeOnline: boolean;
  peerCount: number;
  /** Our PeerID */
  ourPeerId: string | null;
  /** Current view */
  currentView: AppView;
  /** Active modal */
  activeModal: ModalType;
  /** Modal data (e.g., peerId for verification) */
  modalData: any;
  /** Database initialized */
  dbReady: boolean;
  /** App version */
  version: string;

  // Actions
  setTorStatus: (status: AppState['torStatus'], progress?: number) => void;
  setNodeOnline: (online: boolean) => void;
  setPeerCount: (count: number) => void;
  setOurPeerId: (id: string) => void;
  setCurrentView: (view: AppView) => void;
  openModal: (modal: ModalType, data?: any) => void;
  closeModal: () => void;
  setDbReady: (ready: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  torStatus: 'inactive',
  torProgress: 0,
  nodeOnline: false,
  peerCount: 0,
  ourPeerId: null,
  currentView: 'chat',
  activeModal: null,
  modalData: null,
  dbReady: false,
  version: '0.1.0',

  setTorStatus: (status, progress) =>
    set({ torStatus: status, torProgress: progress ?? (status === 'connected' ? 100 : 0) }),
  setNodeOnline: (online) => set({ nodeOnline: online }),
  setPeerCount: (count) => set({ peerCount: count }),
  setOurPeerId: (id) => set({ ourPeerId: id }),
  setCurrentView: (view) => set({ currentView: view }),
  openModal: (modal, data) => set({ activeModal: modal, modalData: data ?? null }),
  closeModal: () => set({ activeModal: null, modalData: null }),
  setDbReady: (ready) => set({ dbReady: ready }),
}));
