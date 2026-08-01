import { create } from 'zustand';
import type { ShareLink, ShareRole } from './link';
import { ensureShare, listShares, revokeShare } from './shareService';

// Two quite different things live here, because they are two sides of one link.
//
//   `links`  — what the OWNER has handed out for the notebook they have open.
//   `guest`  — the link THIS browser arrived on, when the app was opened from a
//              shared URL rather than as yourself.
//
// A browser is never both at once: you are either looking at your own library
// or standing inside someone else's notebook.

export type Guest = {
  token: string;
  role: ShareRole;
  /** Whether the shared copy can be written back. Viewers see a frozen canvas. */
  canEdit: boolean;
  title: string;
};

type ShareState = {
  open: boolean;
  /** Notebook the dialog is about — not necessarily the one on the canvas. */
  sessionId: string | null;
  links: ShareLink[];
  busy: boolean;
  error: string | null;
  guest: Guest | null;
  /** Set when a share URL was opened but could not be honoured. */
  guestError: string | null;
};

type ShareActions = {
  openFor: (sessionId: string) => Promise<void>;
  close: () => void;
  create: (role: ShareRole, isPublic?: boolean) => Promise<ShareLink | null>;
  setPublic: (role: ShareRole, isPublic: boolean) => Promise<void>;
  revoke: (token: string) => Promise<void>;
  setGuest: (guest: Guest | null) => void;
  setGuestError: (message: string | null) => void;
};

export const useShareStore = create<ShareState & ShareActions>()((set, get) => ({
  open: false,
  sessionId: null,
  links: [],
  busy: false,
  error: null,
  guest: null,
  guestError: null,

  async openFor(sessionId) {
    set({ open: true, sessionId, links: [], busy: true, error: null });
    const links = await listShares(sessionId);
    // Guard against a second dialog having been opened while this was in
    // flight — the reply would otherwise fill in the wrong notebook's links.
    if (get().sessionId !== sessionId) return;
    set({ links, busy: false });
  },

  close: () => set({ open: false, sessionId: null, links: [], error: null }),

  async create(role, isPublic = false) {
    const sessionId = get().sessionId;
    if (!sessionId) return null;
    set({ busy: true, error: null });
    const link = await ensureShare(sessionId, role, isPublic);
    if (!link) {
      set({ busy: false, error: 'share-failed' });
      return null;
    }
    set((s) => ({
      busy: false,
      links: [...s.links.filter((l) => l.token !== link.token), link],
    }));
    return link;
  },

  async setPublic(role, isPublic) {
    await get().create(role, isPublic);
  },

  async revoke(token) {
    set({ busy: true, error: null });
    const ok = await revokeShare(token);
    set((s) => ({
      busy: false,
      error: ok ? null : 'revoke-failed',
      links: ok ? s.links.filter((l) => l.token !== token) : s.links,
    }));
  },

  setGuest: (guest) => set({ guest }),
  setGuestError: (guestError) => set({ guestError }),
}));

/** True when this browser is inside someone else's notebook. */
export function isGuest(): boolean {
  return useShareStore.getState().guest !== null;
}
