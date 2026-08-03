import { create } from 'zustand';

/** Which node is having a figure generated, so its card can say so. */
type VisualState = { workingOn: string | null };
type VisualActions = { begin: (nodeId: string) => void; end: () => void };

export const useVisualStore = create<VisualState & VisualActions>()((set) => ({
  workingOn: null,
  begin: (nodeId) => set({ workingOn: nodeId }),
  end: () => set({ workingOn: null }),
}));
