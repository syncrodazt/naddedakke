import { create } from 'zustand';

export type Provider = 'gemini' | 'claude';
export type ModelOption = { id: string; label: string; provider?: Provider };

// Fallback list when /api/models can't be reached (no key locally, offline).
// Claude is omitted: every id here is offered before any key is known to exist,
// and offering a Claude model that then 503s is worse than not offering it.
// Rolling aliases only. Dated snapshots get retired out from under a key —
// gemini-2.5-flash now 404s with "no longer available to new users" — and this
// list is offered before anything has been verified, so it holds the ids least
// likely to have been withdrawn.
const FALLBACK: ModelOption[] = [
  { id: 'gemini-flash-latest', label: 'gemini-flash-latest', provider: 'gemini' },
  { id: 'gemini-flash-lite-latest', label: 'gemini-flash-lite-latest', provider: 'gemini' },
];

const STORAGE_KEY = 'nandedakke.model';
const UNUSABLE_KEY = 'nandedakke.unusableModels';
// Preferred in order: the best Claude model, then the free Gemini default.
const PREFERRED_IDS = ['claude-opus-5', 'gemini-flash-latest'];
const DEFAULT_ID = 'gemini-flash-latest';

/** The provider that owns a model id. Mirrors the routing in services/claude. */
export function providerOf(model: ModelOption): Provider {
  return model.provider ?? (model.id.startsWith('claude-') ? 'claude' : 'gemini');
}

function loadStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Models a real request has already been refused on, remembered across reloads. */
function loadUnusable(): string[] {
  try {
    const raw = localStorage.getItem(UNUSABLE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function saveUnusable(ids: string[]): void {
  try {
    localStorage.setItem(UNUSABLE_KEY, JSON.stringify(ids));
  } catch {
    // private mode — the list just won't survive a reload
  }
}

type ModelState = {
  /** Only models believed usable — the picker shows exactly this. */
  available: ModelOption[];
  selected: string; // the model id sent with every request
  loaded: boolean;
  /** Ids a request was refused on; never offered again. */
  unusable: string[];
};

type ModelActions = {
  loadModels: () => Promise<void>;
  setSelected: (id: string) => void;
  /**
   * Record that the provider refused this model, drop it from the picker and,
   * if it was the selected one, move to the best remaining. Returns the model
   * to use instead, or null when nothing is left to fall back to.
   */
  markUnusable: (id: string) => string | null;
};

export function pickDefault(available: ModelOption[], stored: string | null): string {
  if (stored && available.some((m) => m.id === stored)) return stored;
  for (const id of PREFERRED_IDS) {
    if (available.some((m) => m.id === id)) return id;
  }
  return available[0]?.id ?? DEFAULT_ID;
}

export const useModelStore = create<ModelState & ModelActions>()((set, get) => ({
  available: FALLBACK,
  selected: loadStored() ?? DEFAULT_ID,
  loaded: false,
  unusable: loadUnusable(),

  async loadModels() {
    let listed = FALLBACK;
    try {
      const res = await fetch('/api/models');
      const data: unknown = await res.json();
      const models = (data as { models?: ModelOption[] }).models;
      if (Array.isArray(models) && models.length > 0) listed = models;
    } catch {
      // keep the fallback list
    }
    const unusable = get().unusable;
    const available = listed.filter((m) => !unusable.includes(m.id));
    set({ available, selected: pickDefault(available, loadStored()), loaded: true });
  },

  markUnusable(id) {
    const { unusable, available, selected } = get();
    const nextUnusable = unusable.includes(id) ? unusable : [...unusable, id];
    saveUnusable(nextUnusable);
    const nextAvailable = available.filter((m) => m.id !== id);
    // Falling back within the same provider keeps the failure recoverable
    // without silently switching the learner to a different one.
    const replacement =
      selected === id
        ? nextAvailable.length > 0
          ? pickDefault(nextAvailable, null)
          : null
        : selected;
    if (replacement !== null && replacement !== selected) {
      try {
        localStorage.setItem(STORAGE_KEY, replacement);
      } catch {
        // ignore storage failures
      }
    }
    set({
      unusable: nextUnusable,
      available: nextAvailable,
      ...(replacement !== null ? { selected: replacement } : {}),
    });
    return selected === id ? replacement : null;
  },

  setSelected(id) {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore storage failures (private mode, etc.)
    }
    set({ selected: id });
  },
}));

/** The model id to send with the next request (read outside React). */
export function currentModel(): string {
  return useModelStore.getState().selected;
}
