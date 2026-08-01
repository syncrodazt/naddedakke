import { create } from 'zustand';
import { rangeBetween } from './grouping';

// Which screen is showing, and which notebooks are picked in the library.
//
// Selection lives here rather than in the list component because the bulk-action
// bar, the keyboard handler and the rubber band all need to agree on it, and
// they are siblings — hoisting it any lower would mean threading it through
// every row.

export type View = 'library' | 'canvas';

const SIDEBAR_KEY = 'nandedakke.sidebar';

/** Remembered across reloads: an editor that forgets its sidebar is annoying. */
function initialSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== '0';
  } catch {
    return true;
  }
}

type LibraryState = {
  view: View;
  /** Notebook list beside the canvas. Ctrl/⌘+B. */
  sidebarOpen: boolean;
  selected: Set<string>;
  /** Where the last plain click landed — the fixed end of a shift-click range. */
  anchor: string | null;
};

type LibraryActions = {
  show: (view: View) => void;
  toggleSidebar: () => void;
  /** Plain click: this one only, and it becomes the anchor. */
  select: (id: string) => void;
  /** Ctrl/⌘-click: add or remove without disturbing the rest. */
  toggle: (id: string) => void;
  /** Shift-click: everything between the anchor and here, in visual order. */
  extendTo: (id: string, order: string[]) => void;
  /** Rubber band: replace the selection with exactly what the box covered. */
  setSelection: (ids: string[]) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
};

export const useLibraryStore = create<LibraryState & LibraryActions>()((set, get) => ({
  // The library is the front door: it is the only screen that can answer "what
  // was I working on?", which is the question you arrive with.
  view: 'library',
  sidebarOpen: initialSidebar(),
  selected: new Set(),
  anchor: null,

  show: (view) => set({ view, selected: new Set(), anchor: null }),

  toggleSidebar: () =>
    set((s) => {
      const sidebarOpen = !s.sidebarOpen;
      try {
        localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? '1' : '0');
      } catch {
        // private mode — it just won't survive a reload
      }
      return { sidebarOpen };
    }),

  select: (id) => set({ selected: new Set([id]), anchor: id }),

  toggle: (id) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // The anchor follows the last thing touched, so a shift-click after a
      // ⌘-click extends from where the hand actually is.
      return { selected: next, anchor: id };
    }),

  extendTo: (id, order) => {
    const anchor = get().anchor;
    if (anchor === null) {
      get().select(id);
      return;
    }
    const span = rangeBetween(order, anchor, id);
    // A range that cannot be resolved (the anchor scrolled out of the list)
    // must not silently wipe the selection.
    if (span.length === 0) return;
    set({ selected: new Set(span) });
  },

  setSelection: (ids) => set({ selected: new Set(ids) }),
  selectAll: (ids) => set({ selected: new Set(ids), anchor: ids[ids.length - 1] ?? null }),
  clearSelection: () => set({ selected: new Set(), anchor: null }),
}));
