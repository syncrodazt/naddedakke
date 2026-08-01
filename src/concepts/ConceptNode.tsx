import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { useStrings } from '../i18n';
import type { RankedConcept } from './types';
import type { Tier } from './layout';
import styles from './ConceptTree.module.css';

export type ConceptFlowNode = Node<{
  ranked: RankedConcept;
  tier: Tier;
  /** Outside the selected concept's lineage — faded, not hidden. */
  dimmed: boolean;
}>;

/**
 * One concept in the tree.
 *
 * Colour carries status, using the palette's existing meanings: teal for what
 * is understood, pink for the gap worth going after, muted for what is still
 * out of reach. Size carries leverage, so the cards that open up the most are
 * literally the biggest thing on screen.
 */
export function ConceptNode({ data }: NodeProps<ConceptFlowNode>) {
  const strings = useStrings();
  const { ranked, dimmed } = data;
  const { concept, status } = ranked;

  const tone = status === 'known' ? styles.known : ranked.ready ? styles.ready : styles.blocked;

  return (
    <div className={`${styles.card} ${tone} ${dimmed ? styles.dim : ''}`}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <span className={styles.cardName}>{concept.name}</span>
      <span className={styles.cardMeta}>
        {status === 'known'
          ? strings.conceptKnown
          : status === 'met'
            ? strings.nextUpStarted
            : ranked.ready
              ? strings.conceptReady
              : strings.conceptBlocked}
        {ranked.unlocks > 0 && ` · ${strings.nextUpUnlocks(ranked.unlocks)}`}
      </span>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}
