import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, SESSIONS_TABLE } from './supabase';
import { db } from '../db/db';
import { validateImport } from '../db/exportImport';
import { hasPendingWrites } from '../db/persistence';
import { useGraphStore } from '../store/graphStore';
import { useUIStore } from '../store/uiStore';
import { useReplayStore } from '../replay/replayStore';
import { useRemoteStore } from '../store/remoteStore';

// Live pickup of changes made outside this browser — another device, or the MCP
// server writing on Claude's behalf. Without it a write only appeared after the
// learner remembered to press ☁ Pull.
//
// Two things make this less simple than "subscribe and reload":
//
//  1. This app writes to the same table, on a ~900ms debounce. Every one of its
//     own pushes comes back as an event, so echoes must be filtered or the
//     canvas would reload constantly and fight the learner.
//  2. Reloading replaces the whole store and clears undo history. Doing that
//     mid-stream, or while a compose box holds unsent text, destroys work. So a
//     remote change waits for an idle moment rather than interrupting.

/**
 * `updated_at` values this client produced. Bounded — an echo arrives within
 * seconds, so a handful of recent values is all that is ever needed, and an
 * unbounded set in a long session would just leak.
 */
const ownPushes = new Set<string>();
const OWN_PUSH_MEMORY = 20;

export function noteOwnPush(updatedAt: string): void {
  ownPushes.add(updatedAt);
  if (ownPushes.size > OWN_PUSH_MEMORY) {
    // Sets iterate in insertion order, so this drops the oldest.
    ownPushes.delete(ownPushes.values().next().value as string);
  }
}

/** Whether an event is this client hearing its own write come back. */
export function isOwnEcho(updatedAt: string | undefined): boolean {
  return typeof updatedAt === 'string' && ownPushes.has(updatedAt);
}

export type BusyState = {
  streaming: boolean;
  /** A question compose box is open with text the learner has not sent. */
  composing: boolean;
  dialogOpen: boolean;
  replaying: boolean;
  /** Local edits not yet written to Dexie (and therefore not yet pushed). */
  pendingWrites: boolean;
};

/**
 * Whether it is safe to swap the open session out from under the learner.
 *
 * Pure so the rule is testable: every one of these is a state where a reload
 * would either lose work or yank the view mid-action.
 */
export function canApplyNow(busy: BusyState): boolean {
  return (
    !busy.streaming && !busy.composing && !busy.dialogOpen && !busy.replaying && !busy.pendingWrites
  );
}

function currentBusyState(): BusyState {
  const graph = useGraphStore.getState();
  return {
    streaming: graph.streamingNodeId !== null,
    composing: graph.pendingQuestionId !== null,
    dialogOpen: useUIStore.getState().dialog !== null,
    replaying: useReplayStore.getState().active,
    pendingWrites: hasPendingWrites(),
  };
}

/** Pull one session's row into Dexie. Returns false if it could not be read. */
async function pullSessionIntoDexie(sessionId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from(SESSIONS_TABLE)
    .select('data')
    .eq('id', sessionId)
    .maybeSingle();
  if (error || !data) return false;
  try {
    const exp = validateImport((data as { data: unknown }).data);
    await db.transaction('rw', db.sessions, db.nodes, db.edges, async () => {
      await db.sessions.put(exp.session);
      await db.nodes.bulkPut(exp.nodes);
      await db.edges.bulkPut(exp.edges);
    });
    return true;
  } catch {
    // A row we cannot validate is not worth destroying local state over.
    return false;
  }
}

/**
 * Apply one queued remote change. A session the learner is not looking at is
 * applied silently; the open one is reloaded so the change is actually visible.
 */
async function applyRemote(sessionId: string): Promise<boolean> {
  const ok = await pullSessionIntoDexie(sessionId);
  if (!ok) return false;
  const graph = useGraphStore.getState();
  if (graph.session?.id === sessionId) {
    await graph.loadSession(sessionId);
  } else {
    // Not on screen — just make the project dropdown notice it changed.
    useGraphStore.setState((s) => ({ sessionsRevision: s.sessionsRevision + 1 }));
  }
  return true;
}

// Queued session ids waiting for an idle moment, and the poll that drains them.
let drainTimer: ReturnType<typeof setInterval> | null = null;
const IDLE_POLL_MS = 800;

function scheduleDrain(): void {
  if (drainTimer !== null) return;
  drainTimer = setInterval(() => {
    void drain();
  }, IDLE_POLL_MS);
}

async function drain(): Promise<void> {
  const { pending } = useRemoteStore.getState();
  if (pending.length === 0) {
    if (drainTimer !== null) {
      clearInterval(drainTimer);
      drainTimer = null;
    }
    return;
  }
  if (!canApplyNow(currentBusyState())) return;

  const [next, ...rest] = pending;
  useRemoteStore.setState({ pending: rest });
  const applied = await applyRemote(next!);
  if (applied) useRemoteStore.getState().noteApplied();
}

/** Queue a remote change; it lands as soon as the canvas is idle. */
export function queueRemoteChange(sessionId: string): void {
  useRemoteStore.getState().enqueue(sessionId);
  scheduleDrain();
  void drain(); // usually idle, so apply immediately rather than after a tick
}

let channel: RealtimeChannel | null = null;

/**
 * Listen for changes to this user's rows. Realtime respects RLS, so the filter
 * is belt-and-braces rather than the security boundary.
 */
export function startRealtime(userId: string): void {
  if (!supabase || channel) return;
  channel = supabase
    .channel('rgraph_sessions_changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: SESSIONS_TABLE, filter: `user_id=eq.${userId}` },
      (payload) => {
        const row = payload.new as { id?: string; updated_at?: string } | null;
        if (!row?.id || isOwnEcho(row.updated_at)) return;
        queueRemoteChange(row.id);
      },
    )
    .subscribe();
}

export function stopRealtime(): void {
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  if (drainTimer !== null) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
  useRemoteStore.setState({ pending: [], flashing: false });
}
