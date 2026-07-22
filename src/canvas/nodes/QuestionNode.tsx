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
  const intent = node.branchIntent ?? 'why';
  const pending = useGraphStore((s) => s.pendingQuestionId === node.id);
  const { panToNode, panToHighlight } = useCameraNav();
  // 'why' pre-fills the default question; 'respond' starts empty for the
  // learner to write their own answer.
  const [text, setText] = useState<string>(intent === 'why' ? strings.defaultQuestion : '');

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

  const addIdea = useCallback(() => {
    panToNode(useGraphStore.getState().addIdeaBranch(node.id));
  }, [node.id, panToNode]);

  function submit() {
    const question = text.trim();
    if (question === '') return;
    // 'idea' is a free-form question → answered with the explain prompt.
    void askQuestion(node.id, question, intent === 'respond' ? 'respond' : 'why');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <NodeShell
      nodeId={node.id}
      seq={node.seq}
      label={
        intent === 'respond'
          ? strings.yourAnswerLabel
          : intent === 'idea'
            ? strings.ideaLabel
            : strings.questionLabel
      }
      accent="branch"
      showUnderstood
      onAddIdea={addIdea}
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
            placeholder={
              intent === 'respond'
                ? strings.answerPlaceholder
                : intent === 'idea'
                  ? strings.ideaPlaceholder
                  : strings.askPlaceholder
            }
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
