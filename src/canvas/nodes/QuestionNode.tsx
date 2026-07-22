import { useCallback, useState, type KeyboardEvent } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { strings } from '../../strings';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { useGraphStore } from '../../store/graphStore';
import { useCameraNav } from '../useCameraNav';
import { askQuestion } from '../../services/ask';
import { NodeShell } from './NodeShell';
import styles from './QuestionNode.module.css';

export function QuestionNode({ data }: NodeProps<RFlowNode>) {
  const { node } = data;
  const pending = useGraphStore((s) => s.pendingQuestionId === node.id);
  const { panToNode, panToHighlight } = useCameraNav();
  const [text, setText] = useState<string>(strings.defaultQuestion);

  // Back-navigation: the why edge + the parent's highlight are the
  // bidirectional link — no extra state.
  const backToSource = useCallback(() => {
    const { nodes, edges } = useGraphStore.getState();
    const whyEdge = Object.values(edges).find((e) => e.target === node.id && e.kind === 'why');
    if (!whyEdge) return;
    const parent = nodes[whyEdge.source];
    const highlight = parent?.content.highlights.find((h) => h.childNodeId === node.id);
    if (highlight) panToHighlight(whyEdge.source, highlight.id);
  }, [node.id, panToHighlight]);

  const onHighlightClick = useCallback(
    (highlightId: string) => {
      const child = node.content.highlights.find((h) => h.id === highlightId)?.childNodeId;
      if (child) panToNode(child);
    },
    [node, panToNode],
  );

  function submit() {
    const question = text.trim();
    if (question === '') return;
    void askQuestion(node.id, question);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <NodeShell
      label={strings.questionLabel}
      accent="branch"
      headerExtra={
        <button type="button" className={`${styles.back} nodrag`} onClick={backToSource}>
          {strings.backToSource}
        </button>
      }
    >
      <MarkdownContent
        nodeId={node.id}
        md={node.content.md}
        highlights={node.content.highlights}
        onHighlightClick={onHighlightClick}
      />
      {pending && (
        <div className={styles.compose}>
          <textarea
            className={styles.input}
            value={text}
            autoFocus
            rows={2}
            placeholder={strings.askPlaceholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={(e) => e.target.select()}
          />
          <button type="button" className={styles.send} onClick={submit}>
            {strings.send}
          </button>
        </div>
      )}
    </NodeShell>
  );
}
