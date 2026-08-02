/**
 * The title of a markdown body: its first heading, or failing that its opening
 * line.
 *
 * Used wherever a node has to be named in a list rather than read in full — the
 * replay track list, the concept-map inventory. Blockquote lines are skipped
 * because a question node opens with the passage it quoted, which is its
 * parent's words rather than its own subject.
 */
export function headingOf(md: string): string {
  const heading = /^#{1,6}\s+(.+)$/m.exec(md);
  if (heading?.[1]) return heading[1].trim();
  const firstLine = md
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.startsWith('>'));
  // Strip the commonest inline markers rather than showing raw markdown.
  return (firstLine ?? '')
    .replace(/[*_`#]/g, '')
    .slice(0, 80)
    .trim();
}
