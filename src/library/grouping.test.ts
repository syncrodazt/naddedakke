import { describe, expect, it } from 'vitest';
import {
  flatOrder,
  groupSessions,
  lastTouched,
  localDateKey,
  rangeBetween,
  startOfDay,
} from './grouping';
import type { Session } from '../model/types';

function at(iso: string): number {
  return new Date(iso).getTime();
}

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    mode: 'learn',
    createdAt: at('2026-01-01T00:00:00'),
    seqCounter: 1,
    ...over,
  };
}

const NOW = at('2026-07-31T14:00:00');

describe('lastTouched', () => {
  it('prefers the edit stamp', () => {
    expect(lastTouched(session('a', { createdAt: 100, updatedAt: 500 }))).toBe(500);
  });

  it('falls back to creation for notebooks written before edit stamps existed', () => {
    expect(lastTouched(session('a', { createdAt: 100 }))).toBe(100);
  });
});

describe('groupSessions', () => {
  it('splits into today, yesterday and one group per older day', () => {
    const groups = groupSessions(
      [
        session('older', { updatedAt: at('2026-07-28T09:00:00') }),
        session('today1', { updatedAt: at('2026-07-31T09:00:00') }),
        session('yest', { updatedAt: at('2026-07-30T23:59:00') }),
        session('today2', { updatedAt: at('2026-07-31T13:00:00') }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(['today', 'yesterday', '2026-07-28']);
    expect(groups.map((g) => g.bucket)).toEqual(['today', 'yesterday', 'date']);
    // Newest first inside a group too.
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(['today2', 'today1']);
  });

  it('counts anything after local midnight as today, however early', () => {
    const groups = groupSessions([session('a', { updatedAt: at('2026-07-31T00:00:01') })], NOW);
    expect(groups[0]!.bucket).toBe('today');
  });

  it('puts one minute before midnight in yesterday, not today', () => {
    const groups = groupSessions([session('a', { updatedAt: at('2026-07-30T23:59:59') })], NOW);
    expect(groups[0]!.bucket).toBe('yesterday');
  });

  it('separates two different old days instead of lumping them together', () => {
    const groups = groupSessions(
      [
        session('a', { updatedAt: at('2026-07-20T10:00:00') }),
        session('b', { updatedAt: at('2026-07-21T10:00:00') }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(['2026-07-21', '2026-07-20']);
  });

  it('groups by when it was edited, not when it was created', () => {
    // A notebook started weeks ago but touched today belongs at the top.
    const groups = groupSessions(
      [
        session('old-but-live', {
          createdAt: at('2026-06-01T10:00:00'),
          updatedAt: at('2026-07-31T10:00:00'),
        }),
        session('new-but-idle', { createdAt: at('2026-07-30T10:00:00') }),
      ],
      NOW,
    );
    expect(groups[0]!.key).toBe('today');
    expect(groups[0]!.sessions[0]!.id).toBe('old-but-live');
  });

  it('handles an empty library', () => {
    expect(groupSessions([], NOW)).toEqual([]);
  });

  it('does not reorder the caller’s array', () => {
    const input = [
      session('a', { updatedAt: at('2026-07-20T10:00:00') }),
      session('b', { updatedAt: at('2026-07-31T10:00:00') }),
    ];
    groupSessions(input, NOW);
    expect(input.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('rolls back across a month boundary for yesterday', () => {
    const groups = groupSessions(
      [session('a', { updatedAt: at('2026-06-30T22:00:00') })],
      at('2026-07-01T09:00:00'),
    );
    expect(groups[0]!.bucket).toBe('yesterday');
  });
});

describe('localDateKey / startOfDay', () => {
  it('keys by the local calendar date', () => {
    expect(localDateKey(at('2026-07-05T23:30:00'))).toBe('2026-07-05');
    expect(localDateKey(at('2026-12-31T00:00:00'))).toBe('2026-12-31');
  });

  it('startOfDay lands on local midnight', () => {
    expect(startOfDay(at('2026-07-05T23:30:00'))).toBe(at('2026-07-05T00:00:00'));
  });
});

describe('flatOrder / rangeBetween', () => {
  const groups = groupSessions(
    [
      session('a', { updatedAt: at('2026-07-31T12:00:00') }),
      session('b', { updatedAt: at('2026-07-31T11:00:00') }),
      session('c', { updatedAt: at('2026-07-30T11:00:00') }),
      session('d', { updatedAt: at('2026-07-20T11:00:00') }),
    ],
    NOW,
  );

  it('flattens in the order the list is read', () => {
    expect(flatOrder(groups)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('selects a range that crosses group headings', () => {
    // Shift-click has to reach past "Yesterday" into an older day.
    expect(rangeBetween(flatOrder(groups), 'b', 'd')).toEqual(['b', 'c', 'd']);
  });

  it('works the same clicked bottom-up', () => {
    expect(rangeBetween(flatOrder(groups), 'd', 'b')).toEqual(['b', 'c', 'd']);
  });

  it('a range of one is just that one', () => {
    expect(rangeBetween(flatOrder(groups), 'c', 'c')).toEqual(['c']);
  });

  it('selects nothing when an anchor is no longer listed', () => {
    expect(rangeBetween(flatOrder(groups), 'gone', 'c')).toEqual([]);
  });
});
