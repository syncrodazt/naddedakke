import { setGuestSink } from '../db/persistence';
import { useGraphStore } from '../store/graphStore';
import { buildExport } from '../services/cloudSync';
import { openShare, pushShared } from './shareService';
import { tokenFromUrl } from './link';
import { useShareStore } from './shareStore';

// Arriving on someone else's link.
//
// A guest session is deliberately NOT written to the local database. The
// notebook is not theirs to keep: putting it in Dexie would add a notebook to
// their own library that they cannot fully own, and would still be sitting
// there after the link is revoked. So the graph lives in memory for as long as
// the tab is open, and edits — if the link allows any — go straight back up.

const PUSH_DELAY_MS = 900;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * If this URL carries a share token, open that notebook and put the app into
 * guest mode. Returns true when it took over — the caller then skips its normal
 * "load the last notebook" startup entirely.
 */
export async function enterGuestFromUrl(url: string): Promise<boolean> {
  const token = tokenFromUrl(url);
  if (token === null) return false;

  const opened = await openShare(token);
  if (!opened) {
    // Wrong, revoked, or the cloud is not configured. Say so — a silent fall
    // back to the learner's own library looks like the link did nothing.
    useShareStore.getState().setGuestError('unavailable');
    return false;
  }

  const canEdit = opened.link.role === 'editor';
  useGraphStore.getState().loadGuestSession(opened.data);
  useShareStore.getState().setGuest({
    token,
    role: opened.link.role,
    canEdit,
    title: opened.data.session.title,
  });

  // A viewer's canvas is read-only, so nothing should ever reach here; the sink
  // is still installed for both roles so that a stray write is swallowed rather
  // than landing in the guest's own database.
  setGuestSink((snapshot) => {
    if (!canEdit) return;
    const exp = buildExport(snapshot);
    if (!exp) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void pushShared(token, exp);
    }, PUSH_DELAY_MS);
  });

  return true;
}

/** Undo guest mode — used by tests, and if a link is ever left mid-session. */
export function leaveGuest(): void {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  setGuestSink(null);
  useShareStore.getState().setGuest(null);
}
