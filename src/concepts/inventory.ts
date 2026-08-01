import type { RNode, Session } from '../model/types';
import type { Coverage } from './rank';

// What the learner already has, in a form small enough to send.
//
// The model needs enough to recognise a subject and to see where the gaps are,
// and no more: whole notebooks would be tens of thousands of tokens and would
// bury the signal. Titles plus headings is what a table of contents is, and a
// table of contents is exactly the right resolution for "what do I know".

/** Nodes that carry lesson content, as opposed to the learner's own questions. */
const CONTENT_KINDS = new Set<RNode['kind']>(['chunk', 'answer', 'goal', 'derived']);

export type NotebookSummary = {
  id: string;
  title: string;
  /** Section headings, in seq order — the shape of what was covered. */
  headings: string[];
  understood: number;
  total: number;
};

/** The first markdown heading in a body, or its opening line. */
export function headingOf(md: string): string {
  const heading = /^#{1,6}\s+(.+)$/m.exec(md);
  if (heading?.[1]) return heading[1].trim();
  const firstLine = md
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.startsWith('>'));
  // Strip the commonest inline markers rather than sending raw markdown.
  return (firstLine ?? '')
    .replace(/[*_`#]/g, '')
    .slice(0, 80)
    .trim();
}

/** Cap per notebook: enough to recognise the subject, not a transcript. */
export const MAX_HEADINGS = 12;

export function summarise(session: Session, nodes: RNode[]): NotebookSummary {
  const content = nodes.filter((n) => CONTENT_KINDS.has(n.kind)).sort((a, b) => a.seq - b.seq);
  const headings: string[] = [];
  for (const node of content) {
    const heading = headingOf(node.content.md);
    // Answers often repeat the chunk's heading; a list of duplicates says
    // nothing extra and costs tokens.
    if (heading !== '' && !headings.includes(heading)) headings.push(heading);
    if (headings.length >= MAX_HEADINGS) break;
  }
  return {
    id: session.id,
    title: session.title,
    headings,
    understood: content.filter((n) => n.understood === true).length,
    total: content.length,
  };
}

/** Coverage keyed by session id, for ranking. */
export function coverageOf(summaries: NotebookSummary[]): Coverage {
  return Object.fromEntries(
    summaries.map((s) => [s.id, { understood: s.understood, total: s.total }]),
  );
}

/** The inventory as the prompt sees it. Empty notebooks are left out. */
export function inventoryFor(summaries: NotebookSummary[]): NotebookSummary[] {
  return summaries.filter((s) => s.total > 0);
}
