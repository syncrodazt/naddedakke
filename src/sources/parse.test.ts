import { describe, expect, it } from 'vitest';
import { MAX_SOURCES, SourcesError, parseSources } from './parse';

let n = 0;
const ids = () => `s${++n}`;
const parse = (v: unknown, searched = true) => parseSources(JSON.stringify(v), ids, searched);

describe('parseSources', () => {
  it('reads a well-formed source', () => {
    const [s] = parse({
      sources: [
        {
          url: 'https://arxiv.org/abs/1706.03762',
          title: 'Attention Is All You Need',
          kind: 'paper',
          note: 'the original description of the mechanism',
        },
      ],
    });
    expect(s).toMatchObject({
      kind: 'paper',
      url: 'https://arxiv.org/abs/1706.03762',
      title: 'Attention Is All You Need',
      note: 'the original description of the mechanism',
      searched: true,
    });
  });

  it('drops a source whose URL cannot be opened safely', () => {
    // The one failure that must never render: a citation the learner clicks
    // that is not a citation.
    expect(() =>
      parse({
        sources: [
          { url: 'javascript:alert(1)', title: 'Click me' },
          { url: 'not a url at all', title: 'Also me' },
        ],
      }),
    ).toThrow(SourcesError);
  });

  it('drops a source with no title rather than showing a bare URL', () => {
    const out = parse({
      sources: [
        { url: 'https://example.test/a', title: '' },
        { url: 'https://example.test/b', title: 'Real one' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('Real one');
  });

  it('recognises a video and keeps its timestamp', () => {
    const [s] = parse({
      sources: [
        {
          url: 'https://www.youtube.com/watch?v=aircAruvnKk&t=7m31s',
          title: 'But what is a neural network?',
          kind: 'web',
        },
      ],
    });
    expect(s).toMatchObject({ kind: 'video', videoId: 'aircAruvnKk', at: 451 });
  });

  it('takes a timestamp given beside the URL, in either notation', () => {
    // Models write "7:31" far more readily than they append `&t=451s`.
    const clock = parse({
      sources: [{ url: 'https://youtu.be/aircAruvnKk', title: 'v', at: '7:31' }],
    });
    expect(clock[0]!.at).toBe(451);
    const hms = parse({
      sources: [{ url: 'https://youtu.be/aircAruvnKk', title: 'v', at: '1h2m3s' }],
    });
    expect(hms[0]!.at).toBe(3723);
    const secs = parse({ sources: [{ url: 'https://youtu.be/aircAruvnKk', title: 'v', at: 451 }] });
    expect(secs[0]!.at).toBe(451);
  });

  it('rewrites the link so it lands where the timestamp says', () => {
    // The note says "at 7:31"; clicking must not drop the learner at 0:00.
    const [s] = parse({
      sources: [{ url: 'https://youtu.be/aircAruvnKk', title: 'v', at: '7:31' }],
    });
    expect(s!.url).toBe('https://www.youtube.com/watch?v=aircAruvnKk&t=451s');
  });

  it('prefers the timestamp given beside the URL over one inside it', () => {
    const [s] = parse({
      sources: [{ url: 'https://youtu.be/aircAruvnKk?t=10', title: 'v', at: '7:31' }],
    });
    expect(s!.at).toBe(451);
  });

  it('accepts a bare video id, which is what a model often gives', () => {
    const [s] = parse({ sources: [{ videoId: 'aircAruvnKk', title: 'v', kind: 'video' }] });
    expect(s).toMatchObject({ kind: 'video', videoId: 'aircAruvnKk' });
  });

  it('does not call something a video because the model said so', () => {
    // kind is read off the host. A blog labelled "video" would produce a video
    // node with nothing to play.
    const [s] = parse({ sources: [{ url: 'https://blog.test/post', title: 'v', kind: 'video' }] });
    expect(s!.kind).toBe('web');
    expect(s!.videoId).toBeUndefined();
  });

  it('keeps one entry per page when a search returns it twice', () => {
    const out = parse({
      sources: [
        { url: 'https://youtu.be/aircAruvnKk', title: 'A' },
        { url: 'https://www.youtube.com/watch?v=aircAruvnKk', title: 'A again' },
        { url: 'https://example.test/x', title: 'B' },
      ],
    });
    expect(out).toHaveLength(2);
  });

  it('records whether the provider actually searched', () => {
    // A remembered link and a found one are different objects, and the badge
    // that says so is driven from here.
    const [remembered] = parse({ sources: [{ url: 'https://a.test/x', title: 'A' }] }, false);
    expect(remembered!.searched).toBeUndefined();
  });

  it('caps a long list', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      url: `https://example.test/${i}`,
      title: `S${i}`,
    }));
    expect(parse({ sources: many })).toHaveLength(MAX_SOURCES);
  });

  it('recovers what arrived when the reply was cut short', () => {
    const full = JSON.stringify({
      sources: [
        { url: 'https://a.test/x', title: 'A', note: 'first' },
        { url: 'https://b.test/y', title: 'B', note: 'second' },
      ],
    });
    const out = parseSources(full.slice(0, full.length - 8), ids, true);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]!.title).toBe('A');
  });

  it('says what came back when there is nothing usable', () => {
    expect(() => parseSources('', ids, true)).toThrow(/empty reply/);
    expect(() => parseSources('I could not find any.', ids, true)).toThrow(/could not find/);
    expect(() => parse({ sources: [] })).toThrow(SourcesError);
  });
});
