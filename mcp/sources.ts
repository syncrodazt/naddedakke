import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SessionExport } from '../src/model/types';

// Where the MCP server gets sessions from. The app is local-first and stores
// its graphs in the browser's IndexedDB, which no external process can read —
// so there are exactly two ways in:
//
//   files     a directory of session JSON files (the app's Export button)
//   supabase  the same rows the browser syncs, read as the same user so Row
//             Level Security applies exactly as it does in the app
//
// Both are optional; with neither configured the server starts and reports an
// empty library rather than failing, so a misconfigured client still connects.

export type Source = 'file' | 'cloud';
export type LoadedSession = {
  export: SessionExport;
  source: Source;
  /** file source: where it was read from, so a write lands in the same file. */
  path?: string;
  /** cloud source: the row version a conditional write must still match. */
  updatedAt?: string;
};

export type SourceConfig = {
  /** Directory of exported *.json sessions. */
  dir: string;
  supabase?: { url: string; anonKey: string; email: string; password: string };
};

export const SESSIONS_TABLE = 'rgraph_sessions';

export function configFromEnv(env: NodeJS.ProcessEnv): SourceConfig {
  const dir = env.NANDEDAKKE_DIR
    ? resolve(env.NANDEDAKKE_DIR)
    : join(homedir(), 'nandedakke-sessions');
  const { SUPABASE_URL, SUPABASE_ANON_KEY, NANDEDAKKE_EMAIL, NANDEDAKKE_PASSWORD } = env;
  // All four or none: a half-configured cloud source would fail on every call.
  if (SUPABASE_URL && SUPABASE_ANON_KEY && NANDEDAKKE_EMAIL && NANDEDAKKE_PASSWORD) {
    return {
      dir,
      supabase: {
        url: SUPABASE_URL.trim().replace(/\/+$/, ''),
        anonKey: SUPABASE_ANON_KEY.trim(),
        email: NANDEDAKKE_EMAIL,
        password: NANDEDAKKE_PASSWORD,
      },
    };
  }
  return { dir };
}

/**
 * Shape check on an untrusted file. Deliberately shallow: the app's own
 * validateImport is the strict gate for anything that gets written back, while
 * this only decides whether a file is worth showing. A malformed file is
 * skipped, never fatal — one bad export must not hide the whole library.
 */
export function isSessionExport(v: unknown): v is SessionExport {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const session = o.session as Record<string, unknown> | undefined;
  return (
    o.schemaVersion === 1 &&
    typeof session === 'object' &&
    session !== null &&
    typeof session.id === 'string' &&
    typeof session.title === 'string' &&
    Array.isArray(o.nodes) &&
    Array.isArray(o.edges)
  );
}

async function loadFiles(dir: string): Promise<LoadedSession[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return []; // no directory yet — nothing exported, not an error
  }
  const out: LoadedSession[] = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const path = join(dir, name);
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (isSessionExport(parsed)) out.push({ export: parsed, source: 'file', path });
    } catch {
      // unreadable or not JSON — skip this file, keep the rest
    }
  }
  return out;
}

// Signing in on every tool call would put a round trip in front of every
// question, so the authenticated client is made once and reused. A failed
// sign-in is not cached — the password may have been fixed since.
let clientPromise: Promise<SupabaseClient> | null = null;

function signedInClient(cfg: NonNullable<SourceConfig['supabase']>): Promise<SupabaseClient> {
  if (clientPromise) return clientPromise;
  const pending = (async (): Promise<SupabaseClient> => {
    const client = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false, autoRefreshToken: true },
    });
    const { error } = await client.auth.signInWithPassword({
      email: cfg.email,
      password: cfg.password,
    });
    if (error) throw new Error(`Supabase sign-in failed: ${error.message}`);
    return client;
  })().catch((err: unknown) => {
    clientPromise = null; // the password may be fixed before the next call
    throw err;
  });
  clientPromise = pending;
  return pending;
}

async function loadCloud(cfg: NonNullable<SourceConfig['supabase']>): Promise<LoadedSession[]> {
  const client = await signedInClient(cfg);
  const { data, error } = await client.from(SESSIONS_TABLE).select('data, updated_at');
  if (error) throw new Error(`Supabase read failed: ${error.message}`);

  const rows = (data ?? []) as { data: unknown; updated_at: string }[];
  return (
    rows
      .filter((row) => isSessionExport(row.data))
      // updated_at travels with the session so a later write can be conditional
      // on it — see saveSession.
      .map((row) => ({
        export: row.data as SessionExport,
        source: 'cloud' as const,
        updatedAt: row.updated_at,
      }))
  );
}

/**
 * Every session both sources can see, cloud winning on id collisions — a synced
 * session is newer than the file that was exported from it at some past moment.
 * A cloud failure is reported, not swallowed: silently serving only local files
 * would look like the learner's cloud sessions had vanished.
 */
export async function loadAll(cfg: SourceConfig): Promise<{
  sessions: LoadedSession[];
  cloudError?: string;
}> {
  const files = await loadFiles(cfg.dir);
  let cloud: LoadedSession[] = [];
  let cloudError: string | undefined;
  if (cfg.supabase) {
    try {
      cloud = await loadCloud(cfg.supabase);
    } catch (err) {
      cloudError = err instanceof Error ? err.message : String(err);
    }
  }

  const byId = new Map<string, LoadedSession>();
  for (const s of files) byId.set(s.export.session.id, s);
  for (const s of cloud) byId.set(s.export.session.id, s);
  const sessions = [...byId.values()].sort(
    (a, b) => b.export.session.createdAt - a.export.session.createdAt,
  );
  return cloudError === undefined ? { sessions } : { sessions, cloudError };
}

// ---- Writing -----------------------------------------------------------------
// A session is stored as one blob, so a write is a whole-row/whole-file replace.
// That makes concurrent edits a real hazard: the app pushes the session it has
// in memory on a 900ms debounce, and it does not merge. So the cloud write below
// is conditional on `updated_at` being unchanged since we read it — if the
// browser (or another client) moved underneath us, the write is refused and the
// caller is told to re-read, rather than quietly discarding the learner's edits.

/** Filename for a session's export. Stable, so writes overwrite in place. */
export function fileNameFor(exp: SessionExport): string {
  const slug = exp.session.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return `${slug === '' ? 'session' : slug}-${exp.session.id}.json`;
}

export class ConflictError extends Error {}

async function writeFileSession(dir: string, exp: SessionExport, path?: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const target = path ?? join(dir, fileNameFor(exp));
  await writeFile(target, `${JSON.stringify(exp, null, 2)}\n`, 'utf8');
  return target;
}

async function writeCloudSession(
  cfg: NonNullable<SourceConfig['supabase']>,
  exp: SessionExport,
  expectedUpdatedAt: string | null,
): Promise<void> {
  const client = await signedInClient(cfg);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error('not signed in to Supabase');

  const row = {
    id: exp.session.id,
    user_id: user.id,
    title: exp.session.title,
    updated_at: new Date().toISOString(),
    data: exp,
  };

  if (expectedUpdatedAt === null) {
    // New row: insert, so a session that appeared since our read is not clobbered.
    const { error } = await client.from(SESSIONS_TABLE).insert(row);
    if (error) throw new ConflictError(`could not create cloud session: ${error.message}`);
    return;
  }

  const { data, error } = await client
    .from(SESSIONS_TABLE)
    .update(row)
    .eq('id', exp.session.id)
    .eq('updated_at', expectedUpdatedAt)
    .select('id');
  if (error) throw new Error(`Supabase write failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new ConflictError(
      'this session changed in the cloud since it was read (most likely the app has it ' +
        'open and pushed an edit). Nothing was written — re-read the session and retry.',
    );
  }
}

/**
 * Persist a session back to where it came from: cloud sessions to Supabase,
 * file sessions to their file. A brand-new session goes to the cloud when it is
 * configured — that is the only source the running app actually picks up.
 */
export async function saveSession(
  cfg: SourceConfig,
  exp: SessionExport,
  origin?: LoadedSession,
): Promise<{ source: Source; path?: string }> {
  const target: Source = origin?.source ?? (cfg.supabase ? 'cloud' : 'file');
  if (target === 'cloud') {
    if (!cfg.supabase) throw new Error('cloud source is not configured');
    await writeCloudSession(cfg.supabase, exp, origin?.updatedAt ?? null);
    return { source: 'cloud' };
  }
  const path = await writeFileSession(cfg.dir, exp, origin?.path);
  return { source: 'file', path };
}
