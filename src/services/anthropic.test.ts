import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeService } from './anthropic';
import { GeminiService } from './gemini';
import { extractClaudeText, streamSseText } from './sse';
import { teachService } from './claude';
import { useModelStore } from '../store/modelStore';
import { GOAL_PLAN_SCHEMA } from '../gyakusan/planSchema';
import { parseGoalPlan } from '../gyakusan/plan';

function sseStream(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      controller.close();
    },
  });
}

/** Capture the request the service makes, replying with the given SSE events. */
function stubFetch(events: unknown[]): { calls: { url: string; body: Record<string, unknown> }[] } {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return Promise.resolve(new Response(sseStream(events), { status: 200 }));
  });
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('claude SSE wire shape', () => {
  it('reads text deltas out of our own {text} envelope', async () => {
    const out: string[] = [];
    for await (const t of streamSseText(
      sseStream([{ text: 'なぜ' }, {}, { text: 'なら' }]),
      extractClaudeText,
    )) {
      out.push(t);
    }
    expect(out).toEqual(['なぜ', 'なら']);
  });

  it('raises an error that only surfaced after the stream opened', async () => {
    // Once the 200 is sent the status line is gone, so the proxy reports
    // mid-stream failures in-band. Swallowing them would show a truncated
    // lesson as if it were complete.
    const read = async () => {
      for await (const _drain of streamSseText(
        sseStream([{ text: 'partial' }, { error: 'overloaded_error' }]),
        extractClaudeText,
      )) {
        void _drain;
      }
    };
    await expect(read()).rejects.toThrow('overloaded_error');
  });
});

describe('ClaudeService requests', () => {
  it('streams answers from /api/claude with the selected model', async () => {
    const { calls } = stubFetch([{ text: 'because ' }, { text: 'gravity.' }]);
    useModelStore.setState({ selected: 'claude-sonnet-5' });

    let out = '';
    for await (const d of new ClaudeService().streamAnswer({
      sessionId: 's',
      question: 'why?',
      quotedText: 'q',
      contextMd: 'ctx',
    })) {
      out += d;
    }

    expect(out).toBe('because gravity.');
    expect(calls[0]?.url).toBe('/api/claude');
    expect(calls[0]?.body.model).toBe('claude-sonnet-5');
    expect(calls[0]?.body.effort).toBe('medium');
    expect(calls[0]?.body.schema).toBeUndefined();
  });

  it('asks for a schema-shaped plan at high effort, and returns it whole', async () => {
    const { calls } = stubFetch([{ text: '{"title":' }, { text: '"x"}' }]);
    const raw = await new ClaudeService().decomposeGoal({ goal: 'FIRE by 35' });

    expect(raw).toBe('{"title":"x"}');
    expect(calls[0]?.body.effort).toBe('high');
    expect(calls[0]?.body.schema).toEqual(GOAL_PLAN_SCHEMA);
  });

  it('reports a failed proxy call rather than yielding nothing', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response('{"error":"ANTHROPIC_API_KEY is not configured"}', { status: 503 }),
      ),
    );
    const read = async () => {
      for await (const _drain of new ClaudeService().streamLessonChunk({
        sessionId: 's',
        topic: 't',
        previousChunksMd: [],
        chunkIndex: 0,
      })) {
        void _drain;
      }
    };
    await expect(read()).rejects.toThrow(/503/);
  });
});

describe('provider routing', () => {
  it('sends claude-* models to /api/claude and everything else to /api/chat', async () => {
    for (const [model, endpoint] of [
      ['claude-opus-5', '/api/claude'],
      ['claude-haiku-4-5', '/api/claude'],
      ['gemini-flash-latest', '/api/chat'],
      ['gemma-3-27b-it', '/api/chat'],
    ] as const) {
      const calls: string[] = [];
      vi.stubGlobal('fetch', (url: string) => {
        calls.push(url);
        // Reply in whichever wire shape that endpoint speaks.
        const body =
          url === '/api/claude'
            ? sseStream([{ text: 'x' }])
            : sseStream([{ candidates: [{ content: { parts: [{ text: 'x' }] } }] }]);
        return Promise.resolve(new Response(body, { status: 200 }));
      });
      useModelStore.setState({ selected: model });
      for await (const _drain of teachService.streamAnswer({
        sessionId: 's',
        question: 'q',
        quotedText: 'h',
        contextMd: '',
      })) {
        void _drain;
      }
      expect(calls[0], `${model} routed wrong`).toBe(endpoint);
    }
  });

  it('routes per call, so switching model mid-session switches provider', () => {
    // The router must read the model at call time — a provider captured once at
    // module load would pin the whole session to whatever was selected first.
    expect(teachService).not.toBeInstanceOf(ClaudeService);
    expect(teachService).not.toBeInstanceOf(GeminiService);
  });
});

describe('GOAL_PLAN_SCHEMA', () => {
  it('describes exactly what parseGoalPlan accepts', () => {
    // A schema-conforming plan must survive the parser, otherwise structured
    // output buys nothing.
    const plan = {
      title: 'FIRE',
      goalLabel: 'Required monthly savings',
      goalNote: 'Educational model.',
      variables: [
        { name: 'income', label: 'Income', value: 50, unit: 'k', min: 0, max: 200, step: 1 },
        { name: 'rate', label: 'Savings rate', value: 0.3, unit: '', min: 0, max: 1, step: 0.01 },
      ],
      derived: [
        { name: 'saved', label: 'Saved', formula: 'income * rate', unit: 'k', note: '' },
        { name: 'monthly', label: 'Monthly', formula: 'max(0, saved / 12)', unit: 'k', note: 'n' },
      ],
      goalOf: 'monthly',
    };
    const parsed = parseGoalPlan(JSON.stringify(plan));
    expect(parsed.goalOf).toBe('monthly');
    expect(parsed.derived.map((d) => d.name)).toEqual(['saved', 'monthly']);
  });

  it('requires every property it declares, as strict structured output demands', () => {
    const walk = (node: Record<string, unknown>): void => {
      if (node.type === 'object') {
        const props = Object.keys(node.properties as Record<string, unknown>);
        expect(node.required).toEqual(props);
        expect(node.additionalProperties).toBe(false);
        for (const v of Object.values(node.properties as Record<string, unknown>)) {
          walk(v as Record<string, unknown>);
        }
      }
      if (node.type === 'array') walk(node.items as Record<string, unknown>);
    };
    walk(GOAL_PLAN_SCHEMA);
  });
});
