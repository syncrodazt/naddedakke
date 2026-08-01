import { describe, expect, it } from 'vitest';
import {
  accessOf,
  newShareToken,
  shareUrl,
  tokenFromUrl,
  visibilityOf,
  type ShareLink,
} from './link';

function link(over: Partial<ShareLink> = {}): ShareLink {
  return { token: 't', sessionId: 's', role: 'viewer', isPublic: false, ...over };
}

describe('newShareToken', () => {
  it('is long enough to be unguessable', () => {
    expect(newShareToken().length).toBe(20);
  });

  it('draws from the CSPRNG, not Math.random', () => {
    // A share token is a credential; a predictable one would let anyone
    // enumerate other people's notebooks.
    let called = false;
    const fake = {
      getRandomValues<T extends ArrayBufferView>(a: T): T {
        called = true;
        return crypto.getRandomValues(a as unknown as Uint8Array) as unknown as T;
      },
    } as unknown as Crypto;
    newShareToken(fake);
    expect(called).toBe(true);
  });

  it('produces different tokens', () => {
    const seen = new Set(Array.from({ length: 50 }, () => newShareToken()));
    expect(seen.size).toBe(50);
  });

  it('stays URL-safe and free of characters that get misread', () => {
    for (let i = 0; i < 30; i++) {
      const token = newShareToken();
      expect(token).toMatch(/^[a-z2-9]+$/);
      expect(token).not.toMatch(/[lo01]/);
      expect(encodeURIComponent(token)).toBe(token);
    }
  });
});

describe('shareUrl / tokenFromUrl', () => {
  it('round-trips a token through a URL', () => {
    const token = newShareToken();
    expect(tokenFromUrl(shareUrl('https://nandedakke.com', token))).toBe(token);
  });

  it('does not double the slash when the origin has a trailing one', () => {
    expect(shareUrl('https://nandedakke.com/', 'abc')).toBe('https://nandedakke.com/#/s/abc');
  });

  it('puts the token in the hash, which survives a static-host refresh', () => {
    expect(shareUrl('https://x.dev', 'abc')).toContain('#/s/');
  });

  it('finds nothing in an ordinary app URL', () => {
    expect(tokenFromUrl('https://nandedakke.com/')).toBeNull();
    expect(tokenFromUrl('https://nandedakke.com/#/settings')).toBeNull();
    expect(tokenFromUrl('https://nandedakke.com/#/s/')).toBeNull();
  });

  it('ignores anything appended after the token', () => {
    expect(tokenFromUrl('https://x.dev/#/s/abc123?ref=chat')).toBe('abc123');
  });
});

describe('accessOf', () => {
  it('grants nothing without a link', () => {
    expect(accessOf([])).toBe('none');
  });

  it('grants what the link says', () => {
    expect(accessOf([link({ role: 'viewer' })])).toBe('viewer');
    expect(accessOf([link({ role: 'editor' })])).toBe('editor');
  });

  it('takes the stronger role when both are held', () => {
    expect(accessOf([link({ role: 'viewer' }), link({ role: 'editor' })])).toBe('editor');
  });
});

describe('visibilityOf', () => {
  it('is private with no links', () => {
    expect(visibilityOf([])).toBe('private');
  });

  it('is shared once a link exists', () => {
    expect(visibilityOf([link()])).toBe('shared');
  });

  it('is public when any link is published, even alongside private ones', () => {
    // Published is the stronger claim: a notebook on the open web is on the
    // open web, whatever other links also point at it.
    expect(visibilityOf([link(), link({ token: 'u', role: 'editor', isPublic: true })])).toBe(
      'public',
    );
  });
});
