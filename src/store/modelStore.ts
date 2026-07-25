import { create } from 'zustand';

export type Provider = 'gemini' | 'claude';
export type ModelOption = { id: string; label: string; provider?: Provider };

// Fallback list when /api/models can't be reached (no key locally, offline).
// Claude is omitted: every id here is offered before any key is known to exist,
// and offering a Claude model that then 503s is worse than not offering it.
const FALLBACK: ModelOption[] = [
  { id: 'gemini-flash-latest', label: 'gemini-flash-latest', provider: 'gemini' },
  { id: 'gemini-flash-lite-latest', label: 'gemini-flash-lite-latest', provider: 'gemini' },
  { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash', provider: 'gemini' },
];

const STORAGE_KEY = 'nandedakke.model';
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

type ModelState = {
  available: ModelOption[];
  selected: string; // the model id sent with every request
  loaded: boolean;
};

type ModelActions = {
  loadModels: () => Promise<void>;
  setSelected: (id: string) => void;
};

export function pickDefault(available: ModelOption[], stored: string | null): string {
  if (stored && available.some((m) => m.id === stored)) return stored;
  for (const id of PREFERRED_IDS) {
    if (available.some((m) => m.id === id)) return id;
  }
  return available[0]?.id ?? DEFAULT_ID;
}

export const useModelStore = create<ModelState & ModelActions>()((set) => ({
  available: FALLBACK,
  selected: loadStored() ?? DEFAULT_ID,
  loaded: false,

  async loadModels() {
    let available = FALLBACK;
    try {
      const res = await fetch('/api/models');
      const data: unknown = await res.json();
      const models = (data as { models?: ModelOption[] }).models;
      if (Array.isArray(models) && models.length > 0) available = models;
    } catch {
      // keep the fallback list
    }
    set({ available, selected: pickDefault(available, loadStored()), loaded: true });
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
