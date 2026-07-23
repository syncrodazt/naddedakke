import type { User } from '@supabase/supabase-js';
import { supabase, SESSIONS_TABLE } from './supabase';
import { db } from '../db/db';
import { setFlushListener, type Snapshot } from '../db/persistence';
import { validateImport } from '../db/exportImport';
import type { Session, SessionExport } from '../model/types';

// Cloud sync mirrors each session as one row: { id, user_id, title, updated_at,
// data: SessionExport }. The store stays the truth; Dexie is local durability;
// Supabase is cross-device durability. A logged-in user's local edits are pushed
// up (debounced), and on login all local sessions are pushed and all cloud
// sessions are pulled into Dexie — a union, local winning this device's conflicts.

// Held here (not imported from authStore) to avoid an import cycle: authStore
// pushes the current user in via setCurrentUser.
let currentUser: User | null = null;

export function setCurrentUser(user: User | null): void {
  currentUser = user;
}

export type SessionRow = {
  id: string;
  user_id: string;
  title: string;
  updated_at: string;
  data: SessionExport;
};

/** Build the row Supabase upserts from a session export. Pure — unit-tested. */
export function toRow(exp: SessionExport, userId: string, updatedAt: string): SessionRow {
  return {
    id: exp.session.id,
    user_id: userId,
    title: exp.session.title,
    updated_at: updatedAt,
    data: exp,
  };
}

/** Assemble a SessionExport from a live store snapshot. Pure — unit-tested. */
export function buildExport(snapshot: Snapshot): SessionExport | null {
  if (!snapshot.session) return null;
  return {
    schemaVersion: 1,
    session: snapshot.session,
    nodes: Object.values(snapshot.nodes).sort((a, b) => a.seq - b.seq),
    edges: Object.values(snapshot.edges),
  };
}

async function upsertRow(exp: SessionExport): Promise<void> {
  if (!supabase || !currentUser) return;
  const row = toRow(exp, currentUser.id, new Date().toISOString());
  const { error } = await supabase.from(SESSIONS_TABLE).upsert(row);
  if (error) console.warn('[cloudSync] push failed:', error.message);
}

// Debounced push of the active session, coalescing rapid edits (streaming).
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: SessionExport | null = null;
const PUSH_DELAY_MS = 900;

function scheduleCloudPush(exp: SessionExport): void {
  if (!supabase || !currentUser) return;
  pending = exp;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const exp = pending;
    pending = null;
    if (exp) void upsertRow(exp);
  }, PUSH_DELAY_MS);
}

/** Register the write-behind hook. Called once from authStore.init(). */
export function initCloudSync(): void {
  setFlushListener((snap) => {
    const exp = buildExport(snap);
    if (exp) scheduleCloudPush(exp);
  });
}

async function saveExportToDexie(exp: SessionExport): Promise<void> {
  await db.transaction('rw', db.sessions, db.nodes, db.edges, async () => {
    await db.sessions.put(exp.session);
    await db.nodes.bulkPut(exp.nodes);
    await db.edges.bulkPut(exp.edges);
  });
}

async function readLocalExport(session: Session): Promise<SessionExport> {
  const [nodes, edges] = await Promise.all([
    db.nodes.where('sessionId').equals(session.id).toArray(),
    db.edges.where('sessionId').equals(session.id).toArray(),
  ]);
  return {
    schemaVersion: 1,
    session,
    nodes: nodes.sort((a, b) => a.seq - b.seq),
    edges,
  };
}

/**
 * Reconcile local and cloud on login: push every local session up, then pull
 * every cloud session into Dexie so all devices' work converges. Returns the
 * number of cloud sessions pulled, or null if the cloud is unavailable.
 */
export async function syncOnLogin(): Promise<number | null> {
  if (!supabase || !currentUser) return null;

  // 1. Push all local sessions up (local wins any conflict at this moment).
  const localSessions = await db.sessions.toArray();
  for (const session of localSessions) {
    await upsertRow(await readLocalExport(session));
  }

  // 2. Pull every cloud session down into Dexie.
  const { data, error } = await supabase.from(SESSIONS_TABLE).select('data');
  if (error) {
    console.warn('[cloudSync] pull failed:', error.message);
    return null;
  }
  let pulled = 0;
  for (const row of (data ?? []) as { data: unknown }[]) {
    try {
      const exp = validateImport(row.data);
      await saveExportToDexie(exp);
      pulled += 1;
    } catch (err) {
      console.warn('[cloudSync] skipped invalid cloud session:', err);
    }
  }
  return pulled;
}
