// Share links.
//
// A notebook is private until a link exists for it. The link's token IS the
// credential — holding it is what grants access — so it has to be unguessable,
// and it has to survive being pasted into a chat window, which is why it is
// URL-safe with no characters anything will helpfully "fix".

export type ShareRole = 'viewer' | 'editor';

export type ShareLink = {
  token: string;
  sessionId: string;
  role: ShareRole;
  /** Published Notion-style: the same mechanism, with the secret made public. */
  isPublic: boolean;
  createdAt?: string;
};

/**
 * 160 bits from the platform CSPRNG, base32-ish.
 *
 * Not Math.random(): this is a credential, and a predictable one would let
 * anyone enumerate other people's notebooks. Not a UUID either — v4 spends
 * 6 of its bits on version/variant markers and adds hyphens for no benefit
 * here.
 */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l/o/0/1 — misread when spoken

export function newShareToken(random: Crypto = crypto): string {
  const bytes = new Uint8Array(20);
  random.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** The URL to hand someone. `origin` is passed in so this stays pure. */
export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/#/s/${token}`;
}

/**
 * The token in a URL, or null.
 *
 * Read from the hash rather than the path because the app is served as a static
 * site with no server-side routing — a real path would 404 on a hard refresh.
 */
export function tokenFromUrl(url: string): string | null {
  const hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
  const match = /^#\/s\/([A-Za-z0-9_-]+)/.exec(hash);
  return match?.[1] ?? null;
}

/** What a holder of this set of links may do with the notebook. */
export function accessOf(links: ShareLink[]): 'none' | 'viewer' | 'editor' {
  if (links.some((l) => l.role === 'editor')) return 'editor';
  if (links.some((l) => l.role === 'viewer')) return 'viewer';
  return 'none';
}

/** How a notebook's sharing state reads in one word. */
export type Visibility = 'private' | 'shared' | 'public';

export function visibilityOf(links: ShareLink[]): Visibility {
  if (links.length === 0) return 'private';
  // "Public" is the stronger claim and wins: a notebook published to the web is
  // published, whatever other links also exist.
  return links.some((l) => l.isPublic) ? 'public' : 'shared';
}
