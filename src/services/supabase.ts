import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The Supabase URL + anon key are safe to ship to the browser: the anon key is
// designed to be public, and Row Level Security (see supabase/schema.sql) is the
// real security boundary — every row is stamped with auth.uid() and each user
// can only read/write their own. This is unlike the Gemini API key, which stays
// server-side only.
//
// When the two env vars are absent the client is null and the whole cloud/login
// feature stays dormant: the app runs exactly as before, purely local (Dexie).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isCloudEnabled = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isCloudEnabled
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

/** Table holding one row per session (the full SessionExport as jsonb). */
export const SESSIONS_TABLE = 'rgraph_sessions';
