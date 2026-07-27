import { beforeEach, describe, expect, it } from 'vitest';
import { canApplyNow, isOwnEcho, noteOwnPush, type BusyState } from './cloudRealtime';
import { useRemoteStore } from '../store/remoteStore';

const idle: BusyState = {
  streaming: false,
  composing: false,
  dialogOpen: false,
  replaying: false,
  pendingWrites: false,
};

describe('own-write echo suppression', () => {
  it('recognises a stamp this client produced', () => {
    const stamp = '2026-07-27T10:00:00.000Z';
    expect(isOwnEcho(stamp)).toBe(false);
    noteOwnPush(stamp);
    expect(isOwnEcho(stamp)).toBe(true);
  });

  it('does not claim someone else’s write', () => {
    // Getting this wrong the other way is the dangerous one: a real remote
    // change dismissed as an echo would silently never arrive.
    noteOwnPush('2026-07-27T10:00:01.000Z');
    expect(isOwnEcho('2026-07-27T10:00:02.000Z')).toBe(false);
    expect(isOwnEcho(undefined)).toBe(false);
  });

  it('forgets old stamps instead of growing forever', () => {
    // A long editing session pushes constantly; an unbounded set would leak.
    const first = '2026-07-27T11:00:00.000Z';
    noteOwnPush(first);
    for (let i = 0; i < 25; i += 1)
      noteOwnPush(`2026-07-27T12:00:${String(i).padStart(2, '0')}.000Z`);
    expect(isOwnEcho(first)).toBe(false);
    expect(isOwnEcho('2026-07-27T12:00:24.000Z')).toBe(true);
  });
});

describe('canApplyNow', () => {
  it('applies when the canvas is idle', () => {
    expect(canApplyNow(idle)).toBe(true);
  });

  it.each([
    ['streaming', { streaming: true }],
    ['a compose box is open', { composing: true }],
    ['a dialog is open', { dialogOpen: true }],
    ['replay is running', { replaying: true }],
    ['local edits have not reached Dexie', { pendingWrites: true }],
  ])('holds back while %s', (_why, busy) => {
    // Reloading replaces the whole store and clears undo history, so each of
    // these would either destroy work or yank the view mid-action.
    expect(canApplyNow({ ...idle, ...busy })).toBe(false);
  });
});

describe('the queue', () => {
  beforeEach(() => {
    useRemoteStore.setState({ pending: [], flashing: false });
  });

  it('collapses repeated changes to one session', () => {
    // The row holds the whole session, so a second fetch would supersede the
    // first — queueing both would just reload twice.
    const { enqueue } = useRemoteStore.getState();
    enqueue('a');
    enqueue('a');
    enqueue('b');
    expect(useRemoteStore.getState().pending).toEqual(['a', 'b']);
  });
});
