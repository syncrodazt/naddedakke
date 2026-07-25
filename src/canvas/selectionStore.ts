import { create } from 'zustand';

// React Flow is a controlled component here (nodes are derived from the graph
// store), so selection changes it emits have to be captured or they're dropped.
// This is view-only state — never persisted.

type SelectionState = {
  selected: ReadonlySet<string>;
  setSelected: (nodeId: string, isSelected: boolean) => void;
  clear: () => void;
};

export const useSelectionStore = create<SelectionState>()((set) => ({
  selected: new Set<string>(),

  setSelected: (nodeId, isSelected) =>
    set((s) => {
      if (s.selected.has(nodeId) === isSelected) return s;
      const next = new Set(s.selected);
      if (isSelected) next.add(nodeId);
      else next.delete(nodeId);
      return { selected: next };
    }),

  clear: () => set((s) => (s.selected.size === 0 ? s : { selected: new Set<string>() })),
}));
