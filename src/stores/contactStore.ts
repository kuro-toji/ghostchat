/**
 * GhostChat — Contact Store (Zustand)
 * 
 * Contact list and online status.
 */

import { create } from 'zustand';
import type { Contact } from '../types';

interface ContactState {
  /** All contacts */
  contacts: Contact[];
  /** Search filter text */
  searchQuery: string;

  // Actions
  setContacts: (contacts: Contact[]) => void;
  addContact: (contact: Contact) => void;
  removeContact: (peerId: string) => void;
  updateContact: (peerId: string, updates: Partial<Contact>) => void;
  setOnline: (peerId: string, online: boolean) => void;
  setSearchQuery: (query: string) => void;

  // Selectors
  filteredContacts: () => Contact[];
}

export const useContactStore = create<ContactState>((set, get) => ({
  contacts: [],
  searchQuery: '',

  setContacts: (contacts) => set({ contacts }),
  addContact: (contact) => set((state) => ({ contacts: [...state.contacts, contact] })),
  removeContact: (peerId) =>
    set((state) => ({ contacts: state.contacts.filter((c) => c.peerId !== peerId) })),
  updateContact: (peerId, updates) =>
    set((state) => ({
      contacts: state.contacts.map((c) => (c.peerId === peerId ? { ...c, ...updates } : c)),
    })),
  setOnline: (peerId, online) =>
    set((state) => ({
      contacts: state.contacts.map((c) => (c.peerId === peerId ? { ...c, online } : c)),
    })),
  setSearchQuery: (query) => set({ searchQuery: query }),

  filteredContacts: () => {
    const { contacts, searchQuery } = get();
    if (!searchQuery.trim()) return contacts;
    const q = searchQuery.toLowerCase();
    return contacts.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.peerId.toLowerCase().includes(q)
    );
  },
}));
