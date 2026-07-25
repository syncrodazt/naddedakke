import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SessionExport } from '../src/model/types.js';

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
export type LoadedSession = { export: SessionExport; source: Source; path?: string };

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
  const { data, error } = await client.from(SESSIONS_TABLE).select('data');
  if (error) throw new Error(`Supabase read failed: ${error.message}`);

  return (data ?? [])
    .map((row) => (row as { data: unknown }).data)
    .filter(isSessionExport)
    .map((exp) => ({ export: exp, source: 'cloud' as const }));
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
