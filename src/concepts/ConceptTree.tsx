import { useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
} from '@xyflow/react';
import { useStrings } from '../i18n';
import { ConceptNode, type ConceptFlowNode } from './ConceptNode';
import { CARD_H, layoutConcepts } from './layout';
import { directDependents, directPrereqs, lineage } from './graph';
import type { ConceptMap, RankedConcept } from './types';
import styles from './ConceptTree.module.css';

const nodeTypes = { concept: ConceptNode };

type Props = {
  map: ConceptMap;
  ranked: RankedConcept[];
  onOpen: (item: RankedConcept) => void;
};

/**
 * The skill tree.
 *
 * Foundations on the left, what they open up on the right — the same direction
 * the lesson spine runs, so the picture means the same thing in both places.
 * Selecting a concept fades everything outside its lineage, because the
 * question you are asking of a tree is always "what does this one sit between".
 */
export function ConceptTree({ map, ranked, onOpen }: Props) {
  const strings = useStrings();
  const [selected, setSelected] = useState<string | null>(null);

  const byId = useMemo(() => new Map(ranked.map((r) => [r.concept.id, r])), [ranked]);
  const unlocks = useMemo(
    () => Object.fromEntries(ranked.map((r) => [r.concept.id, r.unlocks])),
    [ranked],
  );
  const positions = useMemo(() => layoutConcepts(map, unlocks), [map, unlocks]);
  const lit = useMemo(() => (selected === null ? null : lineage(map, selected)), [map, selected]);

  const nodes = useMemo<ConceptFlowNode[]>(
    () =>
      map.concepts.flatMap((concept) => {
        const place = positions[concept.id];
        const item = byId.get(concept.id);
        // A concept the learner already knows has no ranked entry — it is not a
        // recommendation — but it still belongs in the picture as the ground
        // the rest stands on.
        const entry: RankedConcept = item ?? {
          concept,
          status: 'known',
          ready: true,
          missing: [],
          unlocks: 0,
          grounding: 0,
        };
        if (!place) return [];
        return [
          {
            id: concept.id,
            type: 'concept',
            position: { x: place.x, y: place.y },
            width: place.width,
            height: CARD_H,
            selected: selected === concept.id,
            data: { ranked: entry, tier: place.tier, dimmed: lit !== null && !lit.has(concept.id) },
          },
        ];
      }),
    [map, positions, byId, lit, selected],
  );

  const edges = useMemo<Edge[]>(
    () =>
      map.concepts.flatMap((concept) =>
        concept.prereqs
          .filter((p) => positions[p] !== undefined)
          .map((p) => ({
            id: `${p}->${concept.id}`,
            source: p,
            target: concept.id,
            className:
              lit !== null && !(lit.has(p) && lit.has(concept.id)) ? styles.edgeDim : styles.edge,
          })),
      ),
    [map, positions, lit],
  );

  const detail = selected === null ? null : byId.get(selected);
  const detailConcept = map.concepts.find((c) => c.id === selected);

  return (
    <div className={styles.wrap}>
      <div className={styles.canvas}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            // Arrow keys pan the tree here; there is nothing to rearrange.
            disableKeyboardA11y
            fitView
            minZoom={0.15}
            onNodeClick={(_, node) => setSelected(node.id)}
            onPaneClick={() => setSelected(null)}
            proOptions={{ hideAttribution: false }}
          >
            <Background variant={BackgroundVariant.Lines} color="var(--grid)" gap={32} />
            <MiniMap pannable zoomable nodeColor="var(--grid)" maskColor="rgb(18 32 46 / 0.08)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>

      {detailConcept && (
        <aside className={styles.panel}>
          <h3 className={styles.panelName}>{detailConcept.name}</h3>
          {detailConcept.blurb !== '' && <p className={styles.panelBlurb}>{detailConcept.blurb}</p>}
          {detailConcept.why !== undefined && (
            <p className={styles.panelWhy}>↳ {detailConcept.why}</p>
          )}

          <Related
            title={strings.conceptNeedsFirst}
            ids={directPrereqs(map, detailConcept.id)}
            map={map}
            byId={byId}
            onSelect={setSelected}
            empty={strings.conceptNoPrereqs}
          />
          <Related
            title={strings.conceptOpensUp}
            ids={directDependents(map, detailConcept.id)}
            map={map}
            byId={byId}
            onSelect={setSelected}
            empty={strings.conceptOpensNothing}
          />

          {detail && (
            <button
              type="button"
              className={styles.panelOpen}
              disabled={!detail.ready}
              onClick={() => onOpen(detail)}
            >
              {detail.status === 'met' ? strings.nextUpContinue : strings.nextUpStart}
            </button>
          )}
        </aside>
      )}
    </div>
  );
}

function Related({
  title,
  ids,
  map,
  byId,
  onSelect,
  empty,
}: {
  title: string;
  ids: string[];
  map: ConceptMap;
  byId: Map<string, RankedConcept>;
  onSelect: (id: string) => void;
  empty: string;
}) {
  const strings = useStrings();
  return (
    <div className={styles.related}>
      <h4 className={styles.relatedTitle}>{title}</h4>
      {ids.length === 0 ? (
        <p className={styles.relatedEmpty}>{empty}</p>
      ) : (
        <ul className={styles.relatedList}>
          {ids.map((id) => {
            const concept = map.concepts.find((c) => c.id === id);
            if (!concept) return null;
            // Absent from the ranking means already known.
            const status = byId.get(id)?.status ?? 'known';
            return (
              <li key={id}>
                <button type="button" className={styles.relatedItem} onClick={() => onSelect(id)}>
                  <span className={status === 'known' ? styles.dotKnown : styles.dotUnknown} />
                  {concept.name}
                  <span className={styles.relatedStatus}>
                    {status === 'known'
                      ? strings.conceptKnown
                      : status === 'met'
                        ? strings.nextUpStarted
                        : strings.conceptNotYet}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
