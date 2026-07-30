import { useCallback, useMemo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { useStrings } from '../../i18n';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { useGraphStore } from '../../store/graphStore';
import { findCheckRange } from '../../services/checkQuestion';
import { useCameraNav } from '../useCameraNav';
import { NodeShell } from './NodeShell';
import { useResolvedHighlights } from './useResolvedHighlights';
import { useDisplayContent } from '../../store/displayContent';
import styles from './ChunkNode.module.css';

export function ChunkNode({ data, selected }: NodeProps<RFlowNode>) {
  const strings = useStrings();
  const { node, displayNum } = data;
  const streaming = useGraphStore((s) => s.streamingNodeId === node.id);
  const { panToNode } = useCameraNav();

  // The body as the learner reads it — the original, or a translation.
  const display = useDisplayContent(node);

  // Highlights whose spawned question has been marked understood — render teal
  // (confusion resolved) instead of pink.
  const resolvedIds = useResolvedHighlights(display.highlights);

  // The Socratic comprehension-check ("> ❓ …") at the end of the chunk. Found
  // in the displayed body, because that is what the offsets it produces index.
  const check = useMemo(() => findCheckRange(display.md), [display.md]);
  // Whether the learner has already answered this check (a respond branch that
  // anchors inside the check range).
  const answered = useMemo(
    () =>
      check !== null &&
      display.highlights.some((h) => h.start >= check.start && h.end <= check.end),
    [check, display.highlights],
  );

  const onHighlightClick = useCallback(
    (highlightId: string) => {
      const child = display.highlights.find((h) => h.id === highlightId)?.childNodeId;
      if (child) panToNode(child);
    },
    [display, panToNode],
  );

  const answerCheck = useCallback(() => {
    if (!check) return;
    const questionId = useGraphStore
      .getState()
      .addWhyBranch(node.id, { ...check, lang: display.bodyLang }, 'respond');
    panToNode(questionId);
  }, [check, display.bodyLang, node.id, panToNode]);

  const addIdea = useCallback(() => {
    panToNode(useGraphStore.getState().addIdeaBranch(node.id));
  }, [node.id, panToNode]);

  return (
    <NodeShell
      nodeId={node.id}
      displayNum={displayNum}
      selected={selected}
      label={streaming ? strings.thinking : strings.chunkLabel}
      showUnderstood
      onAddIdea={addIdea}
    >
      <MarkdownContent
        nodeId={node.id}
        md={display.md}
        highlights={display.highlights}
        resolvedHighlightIds={resolvedIds}
        onHighlightClick={onHighlightClick}
      />
      {check && !streaming && !answered && (
        <button type="button" className={`${styles.checkButton} nodrag`} onClick={answerCheck}>
          {strings.checkUnderstanding}
        </button>
      )}
    </NodeShell>
  );
}
