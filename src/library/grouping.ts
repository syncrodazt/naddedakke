import type { Session } from '../model/types';

// How the notebook library is ordered and grouped.
//
// The unit is the DAY a notebook was last touched, not a rolling "3 hours ago"
// window: what the learner is looking for is "the thing I was working on
// yesterday", and a bucket that shifts under them as the clock moves is worse
// at answering that than a calendar day is.

/** When a notebook last changed. Older files have no stamp; fall back to birth. */
export function lastTouched(session: Session): number {
  return session.updatedAt ?? session.createdAt;
}

export type DayBucket = 'today' | 'yesterday' | 'date';

export type SessionGroup = {
  /** Stable key: 'today', 'yesterday', or the ISO date (local) e.g. '2026-07-30'. */
  key: string;
  bucket: DayBucket;
  /** Start of that local day, for formatting the heading. */
  dayStart: number;
  sessions: Session[];
};

/** Midnight (local) of the day `ms` falls in. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** `YYYY-MM-DD` in local time — the group key for anything older than yesterday. */
export function localDateKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Local midnight of the day before `dayStart`.
 *
 * Not `dayStart - 24h`: on the spring-forward day a local day is 23 hours long,
 * and subtracting a fixed day lands on the day BEFORE yesterday — which would
 * quietly file yesterday's notebooks under a date heading twice a year.
 */
function previousDay(dayStart: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() - 1);
  return startOfDay(d.getTime());
}

/**
 * Group notebooks into Today / Yesterday / one group per older day, newest
 * first within and between groups.
 *
 * `now` is a parameter rather than read from the clock so this is testable and
 * so a list rendered at 23:59 can be re-grouped at 00:01 by passing a new now.
 */
export function groupSessions(sessions: Session[], now: number): SessionGroup[] {
  const today = startOfDay(now);
  const yesterday = previousDay(today);

  const groups = new Map<string, SessionGroup>();
  for (const session of [...sessions].sort((a, b) => lastTouched(b) - lastTouched(a))) {
    const dayStart = startOfDay(lastTouched(session));
    const bucket: DayBucket =
      dayStart >= today ? 'today' : dayStart >= yesterday ? 'yesterday' : 'date';
    const key = bucket === 'date' ? localDateKey(dayStart) : bucket;
    const existing = groups.get(key);
    if (existing) existing.sessions.push(session);
    else groups.set(key, { key, bucket, dayStart, sessions: [session] });
  }
  // Map preserves insertion order, and the input was sorted newest-first, so
  // the groups already come out newest-first.
  return [...groups.values()];
}

/**
 * The visual order of every notebook in the list, flattened. Shift-click needs
 * this: a range runs across group headings, not within one group.
 */
export function flatOrder(groups: SessionGroup[]): string[] {
  return groups.flatMap((g) => g.sessions.map((s) => s.id));
}

/**
 * The ids between two anchors in visual order, inclusive, in either direction.
 * Used by shift-click; an id that is not in the list selects nothing rather
 * than throwing, because the list can change under a held selection.
 */
export function rangeBetween(order: string[], from: string, to: string): string[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a === -1 || b === -1) return [];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}
