import type { MappedSelection } from '../markdown/selectionMapping';

// Each lesson chunk ends with a Socratic comprehension-check rendered as a
// blockquote callout: "> ❓ <question>". This locates the question text so the
// learner can answer it (the answer branch anchors to that exact range, like
// every other branch).
const CHECK_RE = /^>\s*❓\s*(.+)$/m;

export function findCheckRange(md: string): MappedSelection | null {
  const m = CHECK_RE.exec(md);
  if (!m || m[1] === undefined) return null;
  const question = m[1].trim();
  if (question === '') return null;
  const start = md.indexOf(question, m.index);
  if (start === -1) return null;
  return { start, end: start + question.length, text: question };
}
