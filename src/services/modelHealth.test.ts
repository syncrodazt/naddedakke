import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isModelUnavailable } from './modelHealth';
import { useModelStore } from '../store/modelStore';
import { GeminiService } from './gemini';

// The exact body Google returns for a withdrawn model.
const WITHDRAWN =
  '{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available ' +
  'to new users. Please update your code to use a newer model."}}';

describe('isModelUnavailable', () => {
  it('recognises a model the provider has withdrawn', () => {
    expect(isModelUnavailable(404, WITHDRAWN)).toBe(true);
    expect(isModelUnavailable(404, '{"error":{"message":"models/foo is not found"}}')).toBe(true);
  });

  it('leaves transient failures alone', () => {
    // Retiring a model over a rate limit or a blip would quietly shrink the
    // picker for reasons that have nothing to do with the model.
    expect(isModelUnavailable(429, 'rate limit exceeded')).toBe(false);
    expect(isModelUnavailable(500, 'internal error')).toBe(false);
    expect(isModelUnavailable(503, 'GEMINI_API_KEY is not configured')).toBe(false);
    expect(isModelUnavailable(400, 'invalid payload')).toBe(false);
  });
});

const OPTIONS = [
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash', provider: 'gemini' as const },
  { id: 'gemini-flash-latest', label: 'gemini-flash-latest', provider: 'gemini' as const },
];

beforeEach(() => {
  localStorage.clear();
  useModelStore.setState({
    available: OPTIONS,
    selected: 'gemini-2.5-flash',
    loaded: true,
    unusable: [],
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('markUnusable', () => {
  it('drops the model from the picker and moves off it', () => {
    const replacement = useModelStore.getState().markUnusable('gemini-2.5-flash');
    const { available, selected } = useModelStore.getState();
    expect(available.map((m) => m.id)).toEqual(['gemini-flash-latest']);
    expect(selected).toBe('gemini-flash-latest');
    expect(replacement).toBe('gemini-flash-latest');
  });

  it('remembers across reloads, so the dead model is never offered again', () => {
    useModelStore.getState().markUnusable('gemini-2.5-flash');
    expect(JSON.parse(localStorage.getItem('nandedakke.unusableModels')!)).toEqual([
      'gemini-2.5-flash',
    ]);
  });

  it('leaves the selection alone when some other model failed', () => {
    useModelStore.setState({ selected: 'gemini-flash-latest' });
    expect(useModelStore.getState().markUnusable('gemini-2.5-flash')).toBeNull();
    expect(useModelStore.getState().selected).toBe('gemini-flash-latest');
  });

  it('reports no replacement when nothing usable is left', () => {
    useModelStore.setState({ available: [OPTIONS[0]!], selected: 'gemini-2.5-flash' });
    expect(useModelStore.getState().markUnusable('gemini-2.5-flash')).toBeNull();
  });
});

describe('loadModels', () => {
  it('never re-offers a model already known to be refused', () => {
    useModelStore.setState({ unusable: ['gemini-2.5-flash'] });
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ models: OPTIONS }), { status: 200 })),
    );
    return useModelStore
      .getState()
      .loadModels()
      .then(() => {
        expect(useModelStore.getState().available.map((m) => m.id)).toEqual([
          'gemini-flash-latest',
        ]);
      });
  });
});

describe('a request that hits a withdrawn model', () => {
  function sse(text: string): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(c) {
        c.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`,
          ),
        );
        c.close();
      },
    });
  }

  it('retires the model and answers on a working one instead', async () => {
    // The learner should not lose the question to a model the app offered.
    const sent: string[] = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string };
      sent.push(body.model);
      return Promise.resolve(
        body.model === 'gemini-2.5-flash'
          ? new Response(WITHDRAWN, { status: 404 })
          : new Response(sse('answer'), { status: 200 }),
      );
    });

    let out = '';
    for await (const d of new GeminiService().streamAnswer({
      sessionId: 's',
      question: 'why?',
      quotedText: 'q',
      contextMd: '',
    })) {
      out += d;
    }

    expect(sent).toEqual(['gemini-2.5-flash', 'gemini-flash-latest']);
    expect(out).toBe('answer');
    expect(useModelStore.getState().available.map((m) => m.id)).toEqual(['gemini-flash-latest']);
  });

  it('still reports a transient failure rather than swallowing it', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('rate limited', { status: 429 })));
    const read = async () => {
      for await (const _d of new GeminiService().streamLessonChunk({
        sessionId: 's',
        topic: 't',
        previousChunksMd: [],
        chunkIndex: 0,
      })) {
        void _d;
      }
    };
    await expect(read()).rejects.toThrow(/429/);
    // …and the model it was using is still on offer.
    expect(useModelStore.getState().available).toHaveLength(2);
  });
});
