import { useStore } from 'zustand';
import { useGraphStore } from './graphStore';
import { flushNow, markDirty } from '../db/persistence';

// Undo/redo over graph edits, backed by zundo's temporal middleware (see
// graphStore for what is tracked). Two things need care beyond wiring the
// middleware:
//
// 1. Machine-driven bursts must not become history entries. A streamed answer
//    fires a store write per token; without pausing, one lesson chunk would
//    bury the user's real edits under hundreds of steps.
// 2. zundo restores state with a plain set(), which bypasses the write-behind
//    persistence. Undo therefore has to work out what disappeared and mark it
//    deleted, or the change survives a reload.

let pauseDepth = 0;

/** Stop recording (streaming, or any other machine-driven burst). Re-entrant. */
export function pauseHistory(): void {
  if (pauseDepth++ === 0) useGraphStore.temporal.getState().pause();
}

export function resumeHistory(): void {
  pauseDepth = Math.max(0, pauseDepth - 1);
  if (pauseDepth === 0) useGraphStore.temporal.getState().resume();
}

/**
 * Drop all history. Called when the graph is swapped wholesale (new session,
 * session switch, import) — undoing across that boundary would splice one
 * session's nodes into another.
 */
export function clearHistory(): void {
  useGraphStore.temporal.getState().clear();
}

async function applyTemporal(step: () => void): Promise<void> {
  const before = useGraphStore.getState();
  const beforeNodeIds = Object.keys(before.nodes);
  const beforeEdgeIds = Object.keys(before.edges);

  step();

  const after = useGraphStore.getState();
  // Route the restored state back through the normal write-behind path so the
  // Dexie write and the cloud push both happen exactly as they do for an edit.
  markDirty({
    session: true,
    nodeIds: Object.keys(after.nodes),
    edgeIds: Object.keys(after.edges),
    deletedNodeIds: beforeNodeIds.filter((id) => after.nodes[id] === undefined),
    deletedEdgeIds: beforeEdgeIds.filter((id) => after.edges[id] === undefined),
  });
  await flushNow();
  // Gyakusan values are derived state — recompute against the restored graph.
  useGraphStore.getState().recompute();
}

export async function undo(): Promise<void> {
  if (useGraphStore.temporal.getState().pastStates.length === 0) return;
  await applyTemporal(() => useGraphStore.temporal.getState().undo());
}

export async function redo(): Promise<void> {
  if (useGraphStore.temporal.getState().futureStates.length === 0) return;
  await applyTemporal(() => useGraphStore.temporal.getState().redo());
}

/** Reactive counts for enabling the toolbar buttons. */
export function useCanUndo(): boolean {
  return useStore(useGraphStore.temporal, (s) => s.pastStates.length > 0);
}

export function useCanRedo(): boolean {
  return useStore(useGraphStore.temporal, (s) => s.futureStates.length > 0);
}
