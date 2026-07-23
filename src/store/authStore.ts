import { create } from 'zustand';
import type { User } from '@supabase/supabase-js';
import { supabase, isCloudEnabled } from '../services/supabase';
import { initCloudSync, setCurrentUser, syncOnLogin } from '../services/cloudSync';

type AuthState = {
  enabled: boolean; // cloud configured (env vars present)
  status: 'loading' | 'ready';
  user: User | null;
  busy: boolean; // an auth request is in flight
  error: string | null;
  info: string | null; // e.g. "check your email to confirm"
  syncNonce: number; // bumped after a login sync so views can refresh
};

type AuthActions = {
  init: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearMessages: () => void;
};

// Guards against overlapping syncs (INITIAL_SESSION + a fast SIGNED_IN).
let syncing = false;

async function runSync(bump: () => void): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    await syncOnLogin();
    bump();
  } finally {
    syncing = false;
  }
}

export const useAuthStore = create<AuthState & AuthActions>()((set, get) => ({
  enabled: isCloudEnabled,
  status: isCloudEnabled ? 'loading' : 'ready',
  user: null,
  busy: false,
  error: null,
  info: null,
  syncNonce: 0,

  init() {
    if (!supabase) {
      set({ status: 'ready' });
      return;
    }
    initCloudSync();
    const bump = () => set((s) => ({ syncNonce: s.syncNonce + 1 }));
    // onAuthStateChange fires immediately with INITIAL_SESSION, so a separate
    // getSession() call would double-trigger. Rely on this single source.
    supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user ?? null;
      setCurrentUser(user);
      set({ user, status: 'ready' });
      if (user && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
        void runSync(bump);
      }
    });
  },

  async signIn(email, password) {
    if (!supabase) return;
    set({ busy: true, error: null, info: null });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    set({ busy: false });
    if (error) set({ error: error.message });
    // Success path: onAuthStateChange sets the user and kicks off the sync.
  },

  async signUp(email, password) {
    if (!supabase) return;
    set({ busy: true, error: null, info: null });
    const { data, error } = await supabase.auth.signUp({ email, password });
    set({ busy: false });
    if (error) {
      set({ error: error.message });
      return;
    }
    // If email confirmation is enabled in the Supabase project, no session is
    // returned until the user clicks the link in their inbox.
    if (!data.session) {
      set({
        info: 'メールを確認してアカウントを有効化してください / Check your email to confirm.',
      });
    }
  },

  async signOut() {
    if (!supabase) return;
    set({ busy: true, error: null, info: null });
    await supabase.auth.signOut();
    set({ busy: false });
    // onAuthStateChange sets user → null.
  },

  clearMessages() {
    if (get().error || get().info) set({ error: null, info: null });
  },
}));
