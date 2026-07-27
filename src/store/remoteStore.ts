import { create } from 'zustand';

// Remote changes waiting to be applied to the canvas, plus a short-lived flag
// so the UI can say when one landed. Kept out of the graph store on purpose:
// this is transient sync state, not part of the graph, so it must not be
// undoable or persisted.

type RemoteState = {
  /** Session ids queued because the canvas was busy. Deduped, order preserved. */
  pending: string[];
  /** True briefly after a remote change lands, so the UI can say so. */
  flashing: boolean;
};

type RemoteActions = {
  enqueue: (sessionId: string) => void;
  noteApplied: () => void;
};

// The flash timer lives here rather than in the component: expiry is a
// consequence of the change landing, not of anything rendering.
const FLASH_MS = 2600;
let flashTimer: ReturnType<typeof setTimeout> | null = null;

export const useRemoteStore = create<RemoteState & RemoteActions>()((set) => ({
  pending: [],
  flashing: false,

  enqueue: (sessionId) =>
    set((s) =>
      // Two edits to the same session collapse into one pull — the row holds
      // the whole session, so the second fetch would supersede the first anyway.
      s.pending.includes(sessionId) ? s : { pending: [...s.pending, sessionId] },
    ),

  noteApplied: () => {
    set({ flashing: true });
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => set({ flashing: false }), FLASH_MS);
  },
}));
