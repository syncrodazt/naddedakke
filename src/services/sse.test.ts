import { describe, expect, it } from 'vitest';
import { extractGeminiText, parseSseDataLine, streamSseText } from './sse';

function chunk(text: string): string {
  return `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;
}

function toStream(pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const p of pieces) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const t of streamSseText(body)) out.push(t);
  return out;
}

describe('gemini SSE parsing', () => {
  it('extracts text from a stream chunk payload', () => {
    const data = { candidates: [{ content: { parts: [{ text: 'こんにちは' }] } }] };
    expect(extractGeminiText(data)).toBe('こんにちは');
  });

  it('joins multiple parts and tolerates missing fields', () => {
    expect(
      extractGeminiText({
        candidates: [{ content: { parts: [{ text: 'a' }, {}, { text: 'b' }] } }],
      }),
    ).toBe('ab');
    expect(extractGeminiText({})).toBe('');
    expect(extractGeminiText({ candidates: [] })).toBe('');
    expect(extractGeminiText(null)).toBe('');
  });

  it('parses data lines and ignores everything else', () => {
    expect(parseSseDataLine('data: {"x":1}')).toEqual({ x: 1 });
    expect(parseSseDataLine('event: ping')).toBeNull();
    expect(parseSseDataLine('data: [DONE]')).toBeNull();
    expect(parseSseDataLine('data: not-json')).toBeNull();
    expect(parseSseDataLine('')).toBeNull();
  });

  it('streams deltas across whole SSE events', async () => {
    const texts = await collect(toStream([chunk('The sky '), chunk('is blue.')]));
    expect(texts).toEqual(['The sky ', 'is blue.']);
  });

  it('handles events split across arbitrary byte boundaries', async () => {
    const whole = chunk('分割された') + chunk('チャンク');
    const pieces = [whole.slice(0, 17), whole.slice(17, 43), whole.slice(43)];
    const texts = await collect(toStream(pieces));
    expect(texts.join('')).toBe('分割されたチャンク');
  });
});
