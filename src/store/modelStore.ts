import { create } from 'zustand';

export type ModelOption = { id: string; label: string };

// Fallback list when /api/models can't be reached (no key locally, offline).
const FALLBACK: ModelOption[] = [
  { id: 'gemini-flash-latest', label: 'gemini-flash-latest' },
  { id: 'gemini-flash-lite-latest', label: 'gemini-flash-lite-latest' },
  { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
];

const STORAGE_KEY = 'nandedakke.model';
const DEFAULT_ID = 'gemini-flash-latest';

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

function pickDefault(available: ModelOption[], stored: string | null): string {
  if (stored && available.some((m) => m.id === stored)) return stored;
  if (available.some((m) => m.id === DEFAULT_ID)) return DEFAULT_ID;
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
