import { create } from 'zustand';
import { db } from '../db/db';
import { useGraphStore } from '../store/graphStore';
import { isAbort, useLlmStore } from '../store/llmStore';
import { useLangStore } from '../i18n';
import { LANGS } from '../i18n/dict';
import { mockService, teachService } from '../services/claude';
import type { ConceptMapRequest } from '../services/claude/types';
import { ConceptMapError, parseConceptMap } from './parse';
import { coverageOf, inventoryFor, summarise, type NotebookSummary } from './inventory';
import { rankConcepts, type Coverage } from './rank';
import type { ConceptMap, RankedConcept } from './types';

// The "learn next" map: build it, keep it, rank it.
//
// It is regenerated wholesale rather than patched. The map is a proposal about
// a subject, not a record of anything that happened — throwing it away and
// asking again is always correct, and is much easier to reason about than
// merging a new proposal into an old one.

/** New concepts to ask for. Ten is the list; the rest is context for ranking. */
export const WANT_CONCEPTS = 14;

type ConceptState = {
  map: ConceptMap | null;
  coverage: Coverage;
  /** Notebook titles the map was built from, for the staleness notice. */
  currentTitles: string[];
  loading: boolean;
  busy: boolean;
  error: string | null;
};

type ConceptActions = {
  load: () => Promise<void>;
  generate: () => Promise<void>;
  clearError: () => void;
};

async function readInventory(): Promise<NotebookSummary[]> {
  const sessions = await db.sessions.toArray();
  return Promise.all(
    sessions.map(async (session) =>
      summarise(session, await db.nodes.where('sessionId').equals(session.id).toArray()),
    ),
  );
}

export const useConceptStore = create<ConceptState & ConceptActions>()((set) => ({
  map: null,
  coverage: {},
  currentTitles: [],
  loading: false,
  busy: false,
  error: null,

  async load() {
    set({ loading: true });
    const summaries = await readInventory();
    const map = (await db.concepts.get('current')) ?? null;
    set({
      map,
      coverage: coverageOf(summaries),
      currentTitles: inventoryFor(summaries).map((s) => s.title),
      loading: false,
    });
  },

  async generate() {
    set({ busy: true, error: null });
    const summaries = await readInventory();
    const inventory = inventoryFor(summaries);
    const llm = useLlmStore.getState();
    const lang = useLangStore.getState().lang;
    const req: ConceptMapRequest = {
      inventory: inventory.map((s) => ({ id: s.id, title: s.title, headings: s.headings })),
      want: WANT_CONCEPTS,
      langLabel: LANGS.find((l) => l.id === lang)?.label ?? 'English',
      signal: llm.begin(),
    };

    let raw: string;
    try {
      raw = await teachService.suggestConcepts(req);
    } catch (err) {
      if (isAbort(err)) {
        useLlmStore.getState().end();
        set({ busy: false });
        return;
      }
      // Same rule as a back-cast plan: a fabricated curriculum presented as the
      // model's own analysis is exactly the thing the learner must be told
      // about, so the fallback raises the visible notice rather than passing
      // itself off as real.
      llm.noteFallback(err);
      raw = await mockService.suggestConcepts(req);
    } finally {
      useLlmStore.getState().end();
    }

    try {
      const map = parseConceptMap(raw, {
        knownSessionIds: new Set(summaries.map((s) => s.id)),
        generatedAt: Date.now(),
        builtFrom: inventory.map((s) => s.title),
      });
      await db.concepts.put(map);
      set({ map, coverage: coverageOf(summaries), currentTitles: inventory.map((s) => s.title) });
    } catch (err) {
      set({ error: err instanceof ConceptMapError ? err.message : String(err) });
    } finally {
      set({ busy: false });
    }
  },

  clearError: () => set({ error: null }),
}));

/** The ranked list, or empty when there is no map yet. */
export function rankedFrom(state: ConceptState): RankedConcept[] {
  return state.map ? rankConcepts(state.map, state.coverage) : [];
}

/**
 * Notebooks added or removed since the map was built. Shown as a nudge to
 * regenerate rather than doing it automatically: a regeneration is a real API
 * call, and reshuffling the list under someone reading it is worse than a
 * slightly old list.
 */
export function staleTitles(state: ConceptState): string[] {
  if (!state.map) return [];
  const built = new Set(state.map.builtFrom);
  return state.currentTitles.filter((t) => !built.has(t));
}

/** Session ids the graph store can open directly. */
export function openNotebook(sessionId: string): Promise<boolean> {
  return useGraphStore.getState().loadSession(sessionId);
}
