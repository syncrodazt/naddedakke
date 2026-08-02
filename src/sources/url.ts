import type { SourceKind } from './types';

// URL handling for sources. Everything here treats the model's output as
// hostile input, because it is: a link is the one thing in a node the learner
// is meant to trust, and one that renders as real while going somewhere else
// would be worse than having no links at all.

/** YouTube's id grammar. Anything else is not a video, whatever the model said. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

/**
 * A URL that is safe to put in an href, or null.
 *
 * https only. Not pedantry: `javascript:` and `data:` are the two schemes that
 * turn a link into code, and http would be a downgrade the learner did not ask
 * for. Credentials in the authority are stripped rather than carried — they are
 * either meaningless or someone else's.
 */
export function safeUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname === '') return null;
  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';
  return parsed.toString();
}

/**
 * Seconds out of a YouTube time parameter: `90`, `90s`, `1m30s`, `1h2m3s`.
 *
 * Returns null rather than 0 for anything unrecognised, so "could not read the
 * timestamp" stays distinguishable from "starts at the beginning".
 */
export function parseSeconds(t: string): number | null {
  const trimmed = t.trim();
  if (trimmed === '') return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(trimmed);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** The video and start time a URL refers to, if it is a YouTube link at all. */
export function youtubeRef(url: string): { videoId: string; at?: number } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(parsed.hostname)) return null;

  const path = parsed.pathname.replace(/^\/+/, '');
  const candidate = parsed.hostname.endsWith('youtu.be')
    ? path
    : /^(embed|shorts|live|v)\//.test(path)
      ? path.split('/')[1]
      : (parsed.searchParams.get('v') ?? '');
  if (!candidate || !VIDEO_ID.test(candidate)) return null;

  // `t` is what a shared link carries; `start` is what an embed carries.
  const raw = parsed.searchParams.get('t') ?? parsed.searchParams.get('start');
  const at = raw === null ? null : parseSeconds(raw);
  return at === null ? { videoId: candidate } : { videoId: candidate, at };
}

/** True for a string that is a bare YouTube id rather than a URL. */
export function isVideoId(v: string): boolean {
  return VIDEO_ID.test(v);
}

/**
 * The embed URL for a video, built from the id — never from the model's string.
 *
 * This one goes into an iframe `src`, which is the highest-consequence place a
 * URL can land in this app, so it is assembled here from a value that has
 * already been matched against the id grammar. nocookie because the learner did
 * not ask to be tracked for reading a lesson.
 */
export function embedUrl(videoId: string, at?: number): string {
  const start = at !== undefined && at > 0 ? `&start=${Math.floor(at)}` : '';
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0${start}`;
}

/** The ordinary watch URL, for opening the video in its own tab. */
export function watchUrl(videoId: string, at?: number): string {
  const t = at !== undefined && at > 0 ? `&t=${Math.floor(at)}s` : '';
  return `https://www.youtube.com/watch?v=${videoId}${t}`;
}

const PAPER_HOSTS = /(^|\.)(arxiv\.org|doi\.org|.*\.acm\.org|ieeexplore\.ieee\.org|pubmed\..*)$/;
const REPO_HOSTS = /(^|\.)(github\.com|gitlab\.com|codeberg\.org)$/;

/**
 * What kind of source a URL is, read off the host.
 *
 * The host is evidence and the hint is a claim, so where the host knows, the
 * host wins: a blog post labelled "paper" is a blog post. The hint is consulted
 * only where the host settles nothing, because a real paper can live on a
 * university server or a journal no list covers, and filing all of those as
 * plain web pages is its own kind of wrong. The badge is a hint about strength
 * of evidence either way — never a claim that anything was verified.
 */
export function kindOf(url: string, hint?: string): SourceKind {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return 'web';
  }
  if (YOUTUBE_HOSTS.has(host)) return 'video';
  if (PAPER_HOSTS.test(host)) return 'paper';
  if (REPO_HOSTS.test(host)) return 'repo';
  // 'video' is never taken from the hint: a video is something we can embed,
  // and we can only embed what we recognised the host of.
  return hint === 'paper' || hint === 'repo' ? hint : 'web';
}

/** The domain shown under a source's title, so the learner sees where it goes. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** `1:04:07` / `7:31` — how a timestamp is written everywhere a video is. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const parts = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const [h, m, sec] = parts as [number, number, number];
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}
