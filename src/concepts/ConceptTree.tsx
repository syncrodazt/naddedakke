import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
} from '@xyflow/react';
import { useStrings } from '../i18n';
import { ConceptNode, type ConceptFlowNode } from './ConceptNode';
import { AreaNode, type AreaFlowNode } from './AreaNode';
import { CARD_H, layoutConcepts } from './layout';
import { analoguesOf, directDependents, directPrereqs, lineage, sameAsPairs } from './graph';
import type { ConceptMap, RankedConcept } from './types';
import styles from './ConceptTree.module.css';

const nodeTypes = { concept: ConceptNode, area: AreaNode };

/**
 * Hues for the subject bands, spread around the wheel and used at very low
 * saturation. They deliberately do NOT come from the project palette: pink and
 * teal already mean "gap" and "understood" on the cards, and reusing them for
 * subjects would make two different things the same colour.
 */
const BAND_HUES = [210, 28, 140, 280, 340, 55, 190, 320];

type Props = {
  map: ConceptMap;
  ranked: RankedConcept[];
  /** Shown as a caption over the canvas rather than above it, to keep the room. */
  hint: string;
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
export function ConceptTree({ map, ranked, hint, onOpen }: Props) {
  const strings = useStrings();
  const [selected, setSelected] = useState<string | null>(null);

  const byId = useMemo(() => new Map(ranked.map((r) => [r.concept.id, r])), [ranked]);
  const unlocks = useMemo(
    () => Object.fromEntries(ranked.map((r) => [r.concept.id, r.unlocks])),
    [ranked],
  );
  const { positions, bands } = useMemo(() => layoutConcepts(map, unlocks), [map, unlocks]);
  const lit = useMemo(() => (selected === null ? null : lineage(map, selected)), [map, selected]);

  const areaNodes = useMemo<AreaFlowNode[]>(
    () =>
      bands.map((band, i) => ({
        id: `area:${band.area}`,
        type: 'area',
        position: { x: band.x, y: band.y },
        width: band.width,
        height: band.height,
        data: { area: band.area, hue: BAND_HUES[i % BAND_HUES.length]! },
        selectable: false,
        draggable: false,
        // Behind the cards, and never in the way of a click on the pane.
        zIndex: -1,
      })),
    [bands],
  );

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

  const areaOf = useMemo(() => new Map(map.concepts.map((c) => [c.id, c.area])), [map]);

  const edges = useMemo<Edge[]>(
    () =>
      map.concepts.flatMap((concept) =>
        concept.prereqs
          .filter((p) => positions[p] !== undefined)
          .map((p) => {
            const faded = lit !== null && !(lit.has(p) && lit.has(concept.id));
            // An edge leaving its band is the interesting one — the same idea
            // turning up in another subject — so it is drawn as a claim rather
            // than as one more grey line.
            const crosses = areaOf.get(p) !== areaOf.get(concept.id);
            return {
              id: `${p}->${concept.id}`,
              source: p,
              target: concept.id,
              // Orthogonal, not bezier: inside a band these become short right
              // angles you can follow with your eye, where a bundle of curves
              // between two big columns was untraceable.
              type: 'smoothstep',
              pathOptions: { borderRadius: 14 },
              className: faded ? styles.edgeDim : crosses ? styles.edgeCross : styles.edge,
              zIndex: crosses ? 1 : 0,
            };
          }),
      ),
    [map, positions, lit, areaOf],
  );

  /**
   * "The same idea over there" links, drawn unlike anything else on the canvas:
   * no arrow, because the relation is symmetric, and labelled, because the
   * claim is only worth anything with its justification attached.
   */
  const sameAsEdges = useMemo<Edge[]>(
    () =>
      sameAsPairs(map)
        .filter((pair) => positions[pair.a] && positions[pair.b])
        .map((pair) => ({
          id: `same:${pair.a}:${pair.b}`,
          source: pair.a,
          target: pair.b,
          type: 'straight',
          className:
            lit !== null && !(lit.has(pair.a) && lit.has(pair.b))
              ? styles.edgeDim
              : styles.edgeSame,
          label: '≡',
          labelShowBg: true,
          labelBgPadding: [5, 2] as [number, number],
          labelBgBorderRadius: 8,
          zIndex: 2,
        })),
    [map, positions, lit],
  );

  const detail = selected === null ? null : byId.get(selected);
  const detailConcept = map.concepts.find((c) => c.id === selected);

  return (
    <div className={styles.wrap}>
      <div className={styles.canvas}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={[...areaNodes, ...nodes]}
            edges={[...edges, ...sameAsEdges]}
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
            <TreeCamera lit={lit} />
          </ReactFlow>
        </ReactFlowProvider>
        {selected === null && <p className={styles.hint}>{hint}</p>}
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

          {analoguesOf(map, detailConcept.id).length > 0 && (
            <div className={styles.related}>
              <h4 className={styles.relatedTitle}>{strings.conceptSameAs}</h4>
              <ul className={styles.relatedList}>
                {analoguesOf(map, detailConcept.id).map((link) => {
                  const twin = map.concepts.find((c) => c.id === link.id);
                  if (!twin) return null;
                  return (
                    <li key={link.id}>
                      <button
                        type="button"
                        className={styles.relatedItem}
                        onClick={() => setSelected(link.id)}
                      >
                        <span className={styles.dotSame}>≡</span>
                        {twin.name}
                        <span className={styles.relatedStatus}>{twin.area}</span>
                      </button>
                      {/* The justification, always shown: the link is only as
                          good as its account of itself. */}
                      <p className={styles.sameHow}>{link.how}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

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

/**
 * Frames the selected concept's lineage.
 *
 * Two reasons, and the second is the one that matters: selecting is supposed to
 * mean "show me just this line of the tree", and the detail panel opening takes
 * a third of the width away — without a refit the very nodes you just asked
 * about slide underneath it.
 *
 * Renders null and lives inside the provider, so `useReactFlow` re-rendering on
 * viewport changes cannot drag the whole tree with it.
 */
function TreeCamera({ lit }: { lit: Set<string> | null }) {
  const flow = useReactFlow();
  // A joined key rather than the Set: a new Set object every render would refit
  // the camera on every render, fighting the user's own panning.
  const key = lit === null ? '' : [...lit].sort().join(',');
  useEffect(() => {
    // Deferred one beat: selecting mounts the detail panel, which takes a third
    // of the width away. React Flow re-measures on a ResizeObserver, so fitting
    // in this same commit would fit to the width the canvas had a moment ago
    // and leave the nodes it just framed sitting underneath the panel.
    const timer = window.setTimeout(() => {
      if (key === '') {
        void flow.fitView({ duration: 400 });
        return;
      }
      void flow.fitView({
        nodes: key.split(',').map((id) => ({ id })),
        duration: 400,
        maxZoom: 1.2,
        padding: 0.2,
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [key, flow]);
  return null;
}
