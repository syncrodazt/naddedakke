import { create } from 'zustand';

// Which full-screen panel is open. Kept apart from the dialog store: dialogs
// are one-shot questions that resolve a promise, these are places you go.
export type Panel = 'palette' | 'settings';

type PanelState = {
  panel: Panel | null;
  open: (panel: Panel) => void;
  close: () => void;
  toggle: (panel: Panel) => void;
};

export const usePanelStore = create<PanelState>()((set) => ({
  panel: null,
  open: (panel) => set({ panel }),
  close: () => set({ panel: null }),
  toggle: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel })),
}));
