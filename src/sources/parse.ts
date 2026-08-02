import { salvageArrayObjects, stripFence } from '../services/jsonSalvage';
import type { Source } from './types';
import { isVideoId, kindOf, parseSeconds, safeUrl, watchUrl, youtubeRef } from './url';

export class SourcesError extends Error {}

/** Enough to check a claim from more than one angle; more is a reading list. */
export const MAX_SOURCES = 6;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * A timestamp the model gave separately from the URL: seconds, `7:31`, or
 * `1m30s`. Videos are the case where "somewhere in this 40-minute talk" is
 * useless and "at 7:31" is the whole value, so it is worth reading either form.
 */
function startSeconds(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
  const text = str(v);
  if (text === '') return null;
  const clock = /^(?:(\d+):)?(\d+):(\d{2})$/.exec(text);
  if (clock) {
    return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  }
  return parseSeconds(text);
}

/**
 * One entry, or null if there is nothing trustworthy in it.
 *
 * Dropping is deliberate. A source with an unreadable URL is not a slightly
 * worse source, it is a citation that cannot be checked — which is the failure
 * this whole feature exists to fix.
 */
function toSource(v: unknown, id: string, searched: boolean): Source | null {
  if (!isRecord(v)) return null;

  // A model asked for a video sometimes gives the bare id rather than a link.
  const rawUrl = str(v.url);
  const rawId = str(v.videoId);
  const url = safeUrl(rawUrl) ?? (isVideoId(rawId) ? watchUrl(rawId) : null);
  if (url === null) return null;

  const title = str(v.title);
  if (title === '') return null;

  const ref = youtubeRef(url);
  const at = ref ? (startSeconds(v.at) ?? ref.at) : undefined;
  const note = str(v.note);

  return {
    id,
    kind: kindOf(url, str(v.kind)),
    // Rebuilt from the parsed URL, plus the timestamp if one was given
    // separately — so the link the learner clicks lands where the note says.
    url: ref && at !== undefined && at > 0 ? watchUrl(ref.videoId, at) : url,
    title,
    ...(note === '' ? {} : { note }),
    ...(ref ? { videoId: ref.videoId } : {}),
    ...(ref && at !== undefined && at > 0 ? { at } : {}),
    ...(searched ? { searched: true } : {}),
  };
}

/**
 * The sources in a reply.
 *
 * `searched` records whether the provider actually looked things up. It is
 * carried all the way to the badge on the card: a link the model produced from
 * memory and a link it found are different objects, and only one of them is
 * evidence.
 */
export function parseSources(raw: string, newId: () => string, searched: boolean): Source[] {
  let entries: unknown[];
  try {
    const parsed: unknown = JSON.parse(stripFence(raw));
    if (!isRecord(parsed) || !Array.isArray(parsed.sources)) {
      throw new SourcesError('reply has no "sources" array');
    }
    entries = parsed.sources;
  } catch (err) {
    if (err instanceof SourcesError) throw err;
    entries = salvageArrayObjects(raw, 'sources');
  }

  const seen = new Set<string>();
  const out: Source[] = [];
  for (const entry of entries) {
    const source = toSource(entry, newId(), searched);
    if (!source) continue;
    // The same page found by two searches is one source, not two.
    const key = source.videoId ?? source.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
    if (out.length === MAX_SOURCES) break;
  }
  if (out.length === 0) {
    const summary = raw.trim() === '' ? '(empty reply)' : raw.trim().slice(0, 160);
    throw new SourcesError(`no usable sources: ${summary}`);
  }
  return out;
}
