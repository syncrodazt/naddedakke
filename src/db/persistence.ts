import { db } from './db';
import type { REdge, RNode, Session } from '../model/types';

// Write-behind persistence: the Zustand store is the truth, Dexie is
// durability. Mutating store actions call markDirty; a trailing 300ms
// debounce flushes everything dirty in one transaction.

const FLUSH_DELAY_MS = 300;

type Snapshot = {
  session: Session | null;
  nodes: Record<string, RNode>;
  edges: Record<string, REdge>;
};

let getSnapshot: (() => Snapshot) | null = null;

const dirty = {
  session: false,
  nodeIds: new Set<string>(),
  edgeIds: new Set<string>(),
  deletedNodeIds: new Set<string>(),
  deletedEdgeIds: new Set<string>(),
};

let timer: ReturnType<typeof setTimeout> | null = null;

export function initPersistence(snapshotFn: () => Snapshot): void {
  getSnapshot = snapshotFn;
}

export function markDirty(change: {
  session?: boolean;
  nodeIds?: string[];
  edgeIds?: string[];
  deletedNodeIds?: string[];
  deletedEdgeIds?: string[];
}): void {
  if (change.session) dirty.session = true;
  change.nodeIds?.forEach((id) => dirty.nodeIds.add(id));
  change.edgeIds?.forEach((id) => dirty.edgeIds.add(id));
  change.deletedNodeIds?.forEach((id) => {
    dirty.deletedNodeIds.add(id);
    dirty.nodeIds.delete(id);
  });
  change.deletedEdgeIds?.forEach((id) => {
    dirty.deletedEdgeIds.add(id);
    dirty.edgeIds.delete(id);
  });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushNow(), FLUSH_DELAY_MS);
}

export async function flushNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!getSnapshot) return;
  const snap = getSnapshot();

  const sessionPut = dirty.session && snap.session ? [snap.session] : [];
  const nodePuts = [...dirty.nodeIds].map((id) => snap.nodes[id]).filter((n) => n !== undefined);
  const edgePuts = [...dirty.edgeIds].map((id) => snap.edges[id]).filter((e) => e !== undefined);
  const nodeDeletes = [...dirty.deletedNodeIds];
  const edgeDeletes = [...dirty.deletedEdgeIds];

  dirty.session = false;
  dirty.nodeIds.clear();
  dirty.edgeIds.clear();
  dirty.deletedNodeIds.clear();
  dirty.deletedEdgeIds.clear();

  if (
    sessionPut.length === 0 &&
    nodePuts.length === 0 &&
    edgePuts.length === 0 &&
    nodeDeletes.length === 0 &&
    edgeDeletes.length === 0
  ) {
    return;
  }

  await db.transaction('rw', db.sessions, db.nodes, db.edges, async () => {
    if (sessionPut.length) await db.sessions.bulkPut(sessionPut);
    if (nodePuts.length) await db.nodes.bulkPut(nodePuts);
    if (edgePuts.length) await db.edges.bulkPut(edgePuts);
    if (nodeDeletes.length) await db.nodes.bulkDelete(nodeDeletes);
    if (edgeDeletes.length) await db.edges.bulkDelete(edgeDeletes);
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    void flushNow();
  });
}
