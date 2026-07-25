import { create } from 'zustand';

// Visibility and control over the model call in flight.
//
// The graph used to fail silently: when the LLM was unreachable the stream fell
// back to canned mock text and the answer just appeared, indistinguishable from
// a real one. For a tool whose whole point is first-principles understanding,
// silently swapping in invented content is the worst possible failure mode — so
// a fallback now raises a notice the learner has to see and dismiss.

type LlmState = {
  /** Set when a request failed and mock text was served instead. */
  fallbackReason: string | null;
  /** Aborts the request currently streaming, if any. */
  controller: AbortController | null;
};

type LlmActions = {
  /** Start a run: returns the signal to hand to the service. */
  begin: () => AbortSignal;
  end: () => void;
  cancel: () => void;
  noteFallback: (err: unknown) => void;
  dismissFallback: () => void;
};

export const useLlmStore = create<LlmState & LlmActions>()((set, get) => ({
  fallbackReason: null,
  controller: null,

  begin() {
    get().controller?.abort(); // never leave a previous run running
    const controller = new AbortController();
    set({ controller });
    return controller.signal;
  },

  end() {
    set({ controller: null });
  },

  cancel() {
    get().controller?.abort();
    set({ controller: null });
  },

  noteFallback(err) {
    const reason = err instanceof Error ? err.message : String(err);
    set({ fallbackReason: reason.slice(0, 300) });
  },

  dismissFallback() {
    set({ fallbackReason: null });
  },
}));

/** True when the user aborted — not a failure, and never a reason to fall back. */
export function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
