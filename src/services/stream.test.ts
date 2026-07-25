import { describe, expect, it, vi } from 'vitest';
import { withFallback } from './stream';

async function* yields(...items: string[]): AsyncGenerator<string> {
  for (const i of items) yield i;
}

/** Fails before yielding anything — the "service unreachable" shape. */
async function* fails(err: Error): AsyncGenerator<string> {
  if (err) throw err;
  yield '';
}

async function* failsAfter(first: string, err: Error): AsyncGenerator<string> {
  yield first;
  throw err;
}

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const d of gen) out.push(d);
  return out;
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

describe('withFallback', () => {
  it('passes the primary stream through untouched', async () => {
    const onFallback = vi.fn();
    expect(await collect(withFallback(yields('a', 'b'), () => yields('mock'), onFallback))).toEqual(
      ['a', 'b'],
    );
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('serves the fallback and reports it when the primary fails cold', async () => {
    const onFallback = vi.fn();
    const err = new Error('no api key');
    const out = await collect(withFallback(fails(err), () => yields('mock'), onFallback));
    expect(out).toEqual(['mock']);
    // The learner must be told the text is not the model's.
    expect(onFallback).toHaveBeenCalledWith(err);
  });

  it('rethrows a mid-stream failure instead of splicing in mock text', async () => {
    const onFallback = vi.fn();
    const gen = withFallback(
      failsAfter('real', new Error('boom')),
      () => yields('mock'),
      onFallback,
    );
    await expect(collect(gen)).rejects.toThrow('boom');
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('never falls back on an abort — cancelling must not answer with mock text', async () => {
    const onFallback = vi.fn();
    const gen = withFallback(fails(abortError()), () => yields('mock'), onFallback);
    await expect(collect(gen)).rejects.toThrow('aborted');
    expect(onFallback).not.toHaveBeenCalled();
  });
});
