import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import styles from './MarkdownContent.module.css';

// Raw HTML in the markdown stays inert text: react-markdown does not render it
// unless rehype-raw is added. If rehype-raw is ever added, rehype-sanitize must
// come with it — node content comes from an LLM.
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

type MarkdownContentProps = {
  md: string;
};

export const MarkdownContent = memo(function MarkdownContent({ md }: MarkdownContentProps) {
  return (
    <div className={styles.markdown}>
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {md}
      </Markdown>
    </div>
  );
});
