import { create } from 'zustand';

// Which nodes the canvas is currently showing, when something is filtering the
// graph (replay, or re-learn's progressive reveal). `null` means "everything",
// which is the normal case.
//
// Node components need this because a node's appearance can depend on OTHER
// nodes — a highlight is drawn teal once the question it spawned was marked
// understood. Read straight from the graph store, that consults nodes the
// learner has not been shown yet, so replaying a session displayed confusion
// as already-resolved before the resolution appeared. Replay exists to show how
// understanding was built; leaking the ending into frame one defeats it.
//
// Kept out of the graph store on purpose: this is view state, and putting it
// there would make it undoable and persistable, which it must not be.

type VisibilityState = {
  visibleIds: ReadonlySet<string> | null;
  setVisibleIds: (ids: ReadonlySet<string> | null) => void;
};

export const useVisibilityStore = create<VisibilityState>()((set) => ({
  visibleIds: null,
  setVisibleIds: (ids) =>
    // Identity-compare so an unchanged filter doesn't wake every subscriber.
    set((s) => (s.visibleIds === ids ? s : { visibleIds: ids })),
}));

/** Whether a node is on screen right now. True for everything when unfiltered. */
export function isRevealed(visibleIds: ReadonlySet<string> | null, nodeId: string): boolean {
  return visibleIds === null || visibleIds.has(nodeId);
}
