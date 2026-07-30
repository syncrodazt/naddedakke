import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from './graphStore';
import { currentDisplay } from './displayContent';
import { flushNow } from '../db/persistence';
import { db } from '../db/db';
import { exportSession, validateImport } from '../db/exportImport';

async function resetAll() {
  await flushNow();
  await db.transaction('rw', db.sessions, db.nodes, db.edges, async () => {
    await db.sessions.clear();
    await db.nodes.clear();
    await db.edges.clear();
  });
  useGraphStore.setState({
    session: null,
    nodes: {},
    edges: {},
    streamingNodeId: null,
    pendingQuestionId: null,
  });
}

const JA = 'これは複利の話です。';
const TH = 'นี่คือเรื่องดอกเบี้ยทบต้น';

describe('applyTranslations', () => {
  beforeEach(resetAll);

  it('adds a translation without touching the original', async () => {
    const store = useGraphStore.getState();
    await store.createSession('t');
    const id = store.addChunk(JA);

    useGraphStore
      .getState()
      .applyTranslations('th', [{ id, md: TH, sourceLang: 'ja', quotes: [] }]);

    const node = useGraphStore.getState().nodes[id]!;
    expect(node.content.md).toBe(JA);
    expect(node.content.lang).toBe('ja');
    expect(node.content.translations).toEqual({ th: TH });
  });

  it('files the translated quote on the highlight it belongs to', async () => {
    const store = useGraphStore.getState();
    await store.createSession('t');
    const id = store.addChunk(JA);
    const at = JA.indexOf('複利');
    store.addWhyBranch(id, { start: at, end: at + 2, text: '複利' });
    const highlightId = useGraphStore.getState().nodes[id]!.content.highlights[0]!.id;

    useGraphStore.getState().applyTranslations('th', [
      {
        id,
        md: TH,
        sourceLang: 'ja',
        quotes: [{ id: highlightId, text: 'ดอกเบี้ยทบต้น' }],
      },
    ]);

    const highlight = useGraphStore.getState().nodes[id]!.content.highlights[0]!;
    expect(highlight.text).toBe('複利'); // the original quote is untouched
    expect(highlight.quotes).toEqual({ th: 'ดอกเบี้ยทบต้น' });
  });

  it('records the language instead of translating a body to itself', async () => {
    const store = useGraphStore.getState();
    await store.createSession('t');
    const id = store.addChunk(TH);

    useGraphStore
      .getState()
      .applyTranslations('th', [{ id, md: 'anything', sourceLang: 'th', quotes: [] }]);

    const node = useGraphStore.getState().nodes[id]!;
    expect(node.content.lang).toBe('th');
    expect(node.content.translations).toBeUndefined();
  });

  it('ignores results for nodes that are gone', async () => {
    const store = useGraphStore.getState();
    await store.createSession('t');
    expect(() =>
      useGraphStore.getState().applyTranslations('th', [{ id: 'ghost', md: TH, quotes: [] }]),
    ).not.toThrow();
  });
});

describe('reading in another language', () => {
  beforeEach(resetAll);

  it('switches the displayed body and moves the highlight with it', async () => {
    const store = useGraphStore.getState();
    await store.createSession('t');
    const id = store.addChunk(JA);
    const at = JA.indexOf('複利');
    store.addWhyBranch(id, { start: at, end: at + 2, text: '複利' });
    const highlightId = useGraphStore.getState().nodes[id]!.content.highlights[0]!.id;
    useGraphStore
      .getState()
      .applyTranslations('th', [
        { id, md: TH, sourceLang: 'ja', quotes: [{ id: highlightId, text: 'ดอกเบี้ยทบต้น' }] },
      ]);

    useGraphStore.getState().setContentLang('th');
    const shown = currentDisplay(useGraphStore.getState().nodes[id]!);
    expect(shown.md).toBe(TH);
    const highlight = shown.highlights[0]!;
    expect(TH.slice(highlight.start, highlight.end)).toBe('ดอกเบี้ยทบต้น');

    // …and back, with the original highlight intact.
    useGraphStore.getState().setContentLang(undefined);
    const back = currentDisplay(useGraphStore.getState().nodes[id]!);
    expect(back.md).toBe(JA);
    expect(JA.slice(back.highlights[0]!.start, back.highlights[0]!.end)).toBe('複利');
  });

  it('tags a node created while reading a translation with that language', async () => {
    const store = useGraphStore.getState();
    await store.createSession('t');
    useGraphStore.getState().setContentLang('th');
    const id = useGraphStore.getState().addChunk(TH);
    expect(useGraphStore.getState().nodes[id]!.content.lang).toBe('th');
  });

  it('anchors a highlight made in a translation to that translation', async () => {
    const store = useGraphStore.getState();
    await store.createSession('t');
    const id = store.addChunk(JA);
    useGraphStore
      .getState()
      .applyTranslations('th', [{ id, md: TH, sourceLang: 'ja', quotes: [] }]);
    useGraphStore.getState().setContentLang('th');

    const at = TH.indexOf('ทบต้น');
    useGraphStore
      .getState()
      .addWhyBranch(id, { start: at, end: at + 'ทบต้น'.length, text: 'ทบต้น', lang: 'th' });

    const stored = useGraphStore.getState().nodes[id]!.content.highlights[0]!;
    expect(stored.lang).toBe('th');
    // Shown where it was made…
    const inThai = currentDisplay(useGraphStore.getState().nodes[id]!).highlights[0]!;
    expect(TH.slice(inThai.start, inThai.end)).toBe('ทบต้น');
    // …and NOT underlining whatever sits at those offsets in the Japanese body.
    useGraphStore.getState().setContentLang(undefined);
    const inJapanese = currentDisplay(useGraphStore.getState().nodes[id]!).highlights[0]!;
    expect(inJapanese.start).toBe(inJapanese.end);
  });

  it('drops translations when the body is replaced', async () => {
    const store = useGraphStore.getState();
    await store.createSession('t');
    const id = store.addChunk(JA);
    useGraphStore
      .getState()
      .applyTranslations('th', [{ id, md: TH, sourceLang: 'ja', quotes: [] }]);

    // Regenerate blanks the body before streaming the replacement in.
    useGraphStore.getState().setNodeMd(id, '');
    expect(useGraphStore.getState().nodes[id]!.content.translations).toBeUndefined();
  });
});

describe('translations survive a JSON round trip', () => {
  beforeEach(resetAll);

  it('exports and re-imports bodies, quotes and the reading language', async () => {
    const store = useGraphStore.getState();
    await store.createSession('t');
    const id = store.addChunk(JA);
    const at = JA.indexOf('複利');
    store.addWhyBranch(id, { start: at, end: at + 2, text: '複利' });
    const highlightId = useGraphStore.getState().nodes[id]!.content.highlights[0]!.id;
    useGraphStore
      .getState()
      .applyTranslations('th', [
        { id, md: TH, sourceLang: 'ja', quotes: [{ id: highlightId, text: 'ดอกเบี้ยทบต้น' }] },
      ]);
    useGraphStore.getState().setContentLang('th');

    const { session, nodes, edges } = useGraphStore.getState();
    const payload = exportSession(session!, nodes, edges);
    const round = validateImport(JSON.parse(JSON.stringify(payload)));

    expect(round.session.contentLang).toBe('th');
    const chunk = round.nodes.find((n) => n.id === id)!;
    expect(chunk.content.md).toBe(JA);
    expect(chunk.content.lang).toBe('ja');
    expect(chunk.content.translations).toEqual({ th: TH });
    expect(chunk.content.highlights[0]!.quotes).toEqual({ th: 'ดอกเบี้ยทบต้น' });
  });

  it('rejects a file whose translations are not strings', () => {
    const bad = {
      schemaVersion: 1,
      session: { id: 's', title: 't', mode: 'learn', createdAt: 0, seqCounter: 1 },
      nodes: [
        {
          id: 'n',
          sessionId: 's',
          kind: 'chunk',
          seq: 1,
          position: { x: 0, y: 0 },
          content: { md: 'a', highlights: [], translations: { th: 42 } },
        },
      ],
      edges: [],
    };
    expect(() => validateImport(bad)).toThrow(/translations/);
  });
});
