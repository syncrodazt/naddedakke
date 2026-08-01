import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabase, SESSIONS_TABLE } from '../services/supabase';
import { validateImport } from '../db/exportImport';
import type { SessionExport } from '../model/types';
import { newShareToken, type ShareLink, type ShareRole } from './link';

// Talking to Supabase about shares.
//
// Two directions:
//   - the OWNER creates, lists and revokes links for their own notebooks;
//   - a RECIPIENT arrives holding a token and opens the one notebook it names.
//
// The recipient's request carries the token in an `x-rgraph-share` header, which
// PostgREST exposes to the row-level policies. Sending it as a header rather
// than as part of a filter matters: the policy reads the actual HTTP request, so
// a client cannot claim a grant it does not hold (see supabase/schema.sql).

export const SHARES_TABLE = 'rgraph_shares';
export const SHARE_HEADER = 'x-rgraph-share';

type ShareRow = {
  token: string;
  session_id: string;
  owner_id?: string;
  role: ShareRole;
  is_public: boolean;
  created_at?: string;
};

/** Row → the shape the app uses. Pure, so it can be tested without a network. */
export function toShareLink(row: ShareRow): ShareLink {
  return {
    token: row.token,
    sessionId: row.session_id,
    role: row.role,
    isPublic: row.is_public,
    ...(row.created_at !== undefined ? { createdAt: row.created_at } : {}),
  };
}

/** Every link that exists for a notebook the signed-in user owns. */
export async function listShares(sessionId: string): Promise<ShareLink[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(SHARES_TABLE)
    .select('token, session_id, role, is_public, created_at')
    .eq('session_id', sessionId);
  if (error) {
    console.warn('[share] list failed:', error.message);
    return [];
  }
  return (data ?? []).map((row) => toShareLink(row as ShareRow));
}

/**
 * The link for this notebook at this role, creating it if there is none.
 *
 * Re-sharing hands back the SAME url rather than minting a second one: a person
 * who already has the link should not find it silently replaced, and the table's
 * unique (session_id, role) is what guarantees it.
 */
export async function ensureShare(
  sessionId: string,
  role: ShareRole,
  isPublic = false,
): Promise<ShareLink | null> {
  if (!supabase) return null;
  const existing = (await listShares(sessionId)).find((l) => l.role === role);
  if (existing) {
    if (existing.isPublic === isPublic) return existing;
    const { error } = await supabase
      .from(SHARES_TABLE)
      .update({ is_public: isPublic })
      .eq('token', existing.token);
    if (error) {
      console.warn('[share] publish toggle failed:', error.message);
      return existing;
    }
    return { ...existing, isPublic };
  }
  const row: ShareRow = {
    token: newShareToken(),
    session_id: sessionId,
    role,
    is_public: isPublic,
  };
  const { error } = await supabase.from(SHARES_TABLE).insert(row);
  if (error) {
    console.warn('[share] create failed:', error.message);
    return null;
  }
  return toShareLink(row);
}

/** Revoke one link. Anyone still holding that URL loses access immediately. */
export async function revokeShare(token: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from(SHARES_TABLE).delete().eq('token', token);
  if (error) {
    console.warn('[share] revoke failed:', error.message);
    return false;
  }
  return true;
}

// A second client, identical to the main one except that every request carries
// the share token. The token cannot go on the shared client: that client also
// serves the user's own notebooks, and attaching someone else's grant to those
// requests would widen them for no reason.
const shareClients = new Map<string, SupabaseClient>();

function clientFor(token: string): SupabaseClient | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, '');
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  if (!url || !key) return null;
  const cached = shareClients.get(token);
  if (cached) return cached;
  const client = createClient(url, key, {
    // No session persistence: this client speaks for a link, not for a person,
    // and must never overwrite the signed-in user's stored session.
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { [SHARE_HEADER]: token } },
  });
  shareClients.set(token, client);
  return client;
}

export type OpenedShare = { link: ShareLink; data: SessionExport };

/**
 * Open a notebook from a link.
 *
 * Two round trips on purpose: the first resolves the token to a session id and
 * a role, the second fetches the notebook under a policy that re-checks the
 * very same token. Nothing here is trusted to the client — a tampered token
 * simply matches no row.
 *
 * Returns null when the link is unknown, revoked, or the cloud is not
 * configured; the caller says so rather than showing an empty canvas.
 */
export async function openShare(token: string): Promise<OpenedShare | null> {
  const client = clientFor(token);
  if (!client) return null;

  const { data: shareRows, error: shareError } = await client
    .from(SHARES_TABLE)
    .select('token, session_id, role, is_public, created_at')
    .eq('token', token)
    .limit(1);
  if (shareError || !shareRows || shareRows.length === 0) {
    if (shareError) console.warn('[share] open failed:', shareError.message);
    return null;
  }
  const link = toShareLink(shareRows[0] as unknown as ShareRow);

  const { data: sessionRows, error: sessionError } = await client
    .from(SESSIONS_TABLE)
    .select('data')
    .eq('id', link.sessionId)
    .limit(1);
  if (sessionError || !sessionRows || sessionRows.length === 0) {
    if (sessionError) console.warn('[share] fetch failed:', sessionError.message);
    return null;
  }

  try {
    return { link, data: validateImport((sessionRows[0] as { data: unknown }).data) };
  } catch (err) {
    console.warn('[share] shared notebook was malformed:', err);
    return null;
  }
}

/**
 * Push an edited shared notebook back up, under the editor token.
 *
 * Only reached when the link says 'editor'; the policy checks that again, so a
 * viewer who calls this is refused by the database rather than by the UI.
 */
export async function pushShared(token: string, exp: SessionExport): Promise<boolean> {
  const client = clientFor(token);
  if (!client) return false;
  const { error } = await client
    .from(SESSIONS_TABLE)
    .update({
      title: exp.session.title,
      updated_at: new Date().toISOString(),
      data: exp,
    })
    .eq('id', exp.session.id);
  if (error) {
    console.warn('[share] push failed:', error.message);
    return false;
  }
  return true;
}
