import type { RNode } from '../model/types';
import type { TranslateItem, TranslateRequest } from './claude/types';
import { useGraphStore } from '../store/graphStore';
import { useTranslateStore } from '../store/translateStore';
import { isAbort, useLlmStore } from '../store/llmStore';
import { mockService, teachService } from './claude';

// Reading a notebook in another language.
//
// Every node is sent, all batches at once, and each batch is applied the moment
// it lands — so the canvas fills in progressively instead of sitting blank until
// the slowest node comes back. A notebook is 10-40 short bodies; splitting it
// into a handful of concurrent calls is what makes "translate the whole thing"
// take one wait rather than one wait per node.

/**
 * Nodes per request. Small enough that one slow batch doesn't hold the notebook
 * hostage and that a malformed reply loses only a few nodes; large enough that
 * a 30-node notebook is 4 calls, not 30.
 */
export const TRANSLATE_BATCH = 8;

export type TranslatedItem = {
  id: string;
  md: string;
  sourceLang?: string;
  quotes: { id: string; text: string }[];
};

export class TranslateError extends Error {}

export function chunkInto<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error('batch size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The nodes that still need translating into `lang`, as request items.
 *
 * Skipped: empty bodies (a node still streaming, or a placeholder), nodes
 * already written in the target language, and nodes that already have this
 * translation — so asking again after adding a few questions costs only the
 * new ones.
 */
export function pendingItems(nodes: Record<string, RNode>, lang: string): TranslateItem[] {
  return Object.values(nodes)
    .filter((n) => n.content.md.trim() !== '')
    .filter((n) => n.content.lang !== lang)
    .filter((n) => n.content.translations?.[lang] === undefined)
    .sort((a, b) => a.seq - b.seq)
    .map((n) => ({
      id: n.id,
      md: n.content.md,
      // A quote may be in a different language than the body (the learner
      // highlighted while reading a translation). It is sent as-is; the prompt
      // asks the model to find the passage it refers to.
      quotes: n.content.highlights
        .filter((h) => h.text !== '')
        .map((h) => ({ id: h.id, text: h.text })),
    }));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Strip a ```json fence some providers add despite being told not to. */
function stripFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
}

/**
 * Parse a translation reply. Untrusted model output, so anything malformed is
 * dropped rather than written into the graph.
 *
 * A quote that does not occur verbatim in the body it came back with is
 * dropped too: keeping it would place the highlight at whatever the search
 * happens to find, and a wrong underline is worse than none — an unmatched
 * quote collapses to a zero-width anchor, which still keeps the branch linked.
 */
export function parseTranslation(raw: string): TranslatedItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    throw new TranslateError('translation reply was not JSON');
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
    throw new TranslateError('translation reply has no "items" array');
  }

  const out: TranslatedItem[] = [];
  for (const entry of parsed.items) {
    if (!isRecord(entry)) continue;
    const { id, md, sourceLang, quotes } = entry;
    if (typeof id !== 'string' || id === '') continue;
    if (typeof md !== 'string' || md.trim() === '') continue;

    const kept: { id: string; text: string }[] = [];
    if (Array.isArray(quotes)) {
      for (const q of quotes) {
        if (!isRecord(q)) continue;
        if (typeof q.id !== 'string' || typeof q.text !== 'string') continue;
        if (q.text === '' || !md.includes(q.text)) continue;
        kept.push({ id: q.id, text: q.text });
      }
    }
    out.push({
      id,
      md,
      ...(typeof sourceLang === 'string' && sourceLang !== '' ? { sourceLang } : {}),
      quotes: kept,
    });
  }
  if (out.length === 0) throw new TranslateError('translation reply had no usable items');
  return out;
}

export type TranslateSummary = { total: number; translated: number; failed: number };

/**
 * Translate the open notebook into `lang` and switch the view to it.
 *
 * The view switches FIRST, so the language change is immediate and nodes fill
 * in behind it; anything not yet translated keeps showing its original text,
 * which is the same thing that happens to a node added after a translation run.
 */
export async function translateNotebook(
  lang: string,
  label: string,
): Promise<TranslateSummary | null> {
  const store = useGraphStore.getState();
  if (!store.session) return null;

  store.setContentLang(lang);

  const items = pendingItems(store.nodes, lang);
  if (items.length === 0) return { total: 0, translated: 0, failed: 0 };

  const llm = useLlmStore.getState();
  const signal = llm.begin();
  const progress = useTranslateStore.getState();
  progress.begin(items.length);

  let translated = 0;
  let failed = 0;

  await Promise.all(
    chunkInto(items, TRANSLATE_BATCH).map(async (batch) => {
      const req: TranslateRequest = { targetLang: lang, targetLabel: label, items: batch, signal };
      let raw: string;
      try {
        raw = await teachService.translate(req);
      } catch (err) {
        if (isAbort(err)) {
          failed += batch.length;
          useTranslateStore.getState().advance(batch.length);
          return;
        }
        // No key, no proxy, offline: the mock marks the bodies rather than
        // leaving the learner staring at a run that silently did nothing.
        useLlmStore.getState().noteFallback(err);
        raw = await mockService.translate(req);
      }
      try {
        const results = parseTranslation(raw);
        useGraphStore.getState().applyTranslations(lang, results);
        translated += results.length;
        failed += batch.length - results.length;
      } catch (err) {
        console.warn('translation batch discarded:', err);
        failed += batch.length;
      } finally {
        useTranslateStore.getState().advance(batch.length);
      }
    }),
  );

  useLlmStore.getState().end();
  useTranslateStore.getState().finish();
  return { total: items.length, translated, failed };
}
