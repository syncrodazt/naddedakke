import { create } from 'zustand';

/** Which node is having its sources looked up, so its card can say so. */
type SourceState = { findingFor: string | null };
type SourceActions = { begin: (nodeId: string) => void; end: () => void };

export const useSourceStore = create<SourceState & SourceActions>()((set) => ({
  findingFor: null,
  begin: (nodeId) => set({ findingFor: nodeId }),
  end: () => set({ findingFor: null }),
}));
