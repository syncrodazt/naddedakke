import { memo, useMemo, type MouseEvent } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { Highlight } from '../model/types';
import { rehypeSourceOffsets } from './rehypeSourceOffsets';
import { rehypeHighlightMarks } from './rehypeHighlightMarks';
import styles from './MarkdownContent.module.css';

// Raw HTML in the markdown stays inert text: react-markdown does not render it
// unless rehype-raw is added. If rehype-raw is ever added, rehype-sanitize must
// come with it — node content comes from an LLM.
const remarkPlugins = [remarkGfm, remarkMath];

type MarkdownContentProps = {
  nodeId: string;
  md: string;
  highlights?: Highlight[];
  resolvedHighlightIds?: string[]; // highlights whose question is understood → teal
  onHighlightClick?: (highlightId: string) => void;
};

export const MarkdownContent = memo(function MarkdownContent({
  nodeId,
  md,
  highlights,
  resolvedHighlightIds,
  onHighlightClick,
}: MarkdownContentProps) {
  const resolvedKey = (resolvedHighlightIds ?? []).join(',');
  const rehypePlugins = useMemo(
    () => [
      () => rehypeSourceOffsets(md),
      () => rehypeHighlightMarks(highlights ?? [], new Set(resolvedHighlightIds ?? [])),
      rehypeKatex,
    ],
    // resolvedKey is a stable string form of resolvedHighlightIds for memoization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [md, highlights, resolvedKey],
  );

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    if (!onHighlightClick) return;
    const mark = (e.target as HTMLElement).closest<HTMLElement>('mark[data-highlight-id]');
    const id = mark?.dataset.highlightId;
    if (id) onHighlightClick(id);
  }

  return (
    <div className={styles.markdown} data-node-id={nodeId} onClick={handleClick}>
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {md}
      </Markdown>
    </div>
  );
});
