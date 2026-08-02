import { useCallback, useRef, useState, type MouseEvent } from 'react';
import {
  ReactFlow,
  useReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { nodeTypes } from './nodes/nodeTypes';
import { useGraphStore } from '../store/graphStore';
import { findVideoForHighlight } from '../sources/video';
import { useTextSelection, type ActiveSelection } from './useTextSelection';
import { useCameraNav } from './useCameraNav';
import { WhyButton } from './WhyButton';
import { NodeContextMenu, type MenuState } from './NodeContextMenu';
import { useSelectionStore } from './selectionStore';
import { nodeAt } from './spatialNav';
import { currentMetrics } from '../layout/metrics';
import { nextLessonChunk, prerequisiteChunk } from '../services/lesson';
import { reprompt } from '../services/reprompt';
import styles from './Canvas.module.css';

/**
 * How long after a press on prose a double-click still counts as that press.
 * Comfortably longer than a double-click, shorter than a deliberate pause.
 */
const BODY_PRESS_MS = 700;

type CanvasProps = {
  nodes: Node[];
  edges: Edge[];
  /** Replay mode: no dragging, no new branches. */
  readOnly?: boolean;
};

export function Canvas({ nodes, edges, readOnly = false }: CanvasProps) {
  const setNodePosition = useGraphStore((s) => s.setNodePosition);
  const setNodeSize = useGraphStore((s) => s.setNodeSize);
  const [selection, clearSelection] = useTextSelection();
  const { panToNode, zoomToNode } = useCameraNav();
  const { screenToFlowPosition } = useReactFlow();
  const [menu, setMenu] = useState<MenuState | null>(null);
  /** When the pointer last went down on a node's prose. See onDoubleClick. */
  const lastBodyPress = useRef(0);

  const onNodeContextMenu = useCallback((e: MouseEvent, node: Node) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
  }, []);

  /**
   * Double-click a card to focus it and bring the camera in.
   *
   * Which node was hit is worked out from the POINTER, not from the event
   * target. Measured: the first click of a pair selects the card and re-renders
   * it, and the browser then reports the canvas underneath as the target of the
   * second click — so neither a DOM handler on the node nor React Flow's own
   * onNodeDoubleClick ever fires. The graph knows where its cards are, so it is
   * asked directly.
   *
   * The prose body is excluded: double-clicking text selects a word, and that
   * is the gesture this whole app is built around.
   */
  const onDoubleClick = useCallback(
    (e: MouseEvent) => {
      // Whether this was a press on prose is judged from the mousedown, for the
      // same reason: by the time the dblclick is dispatched its own target is
      // the canvas. The mousedown that opened the pair still points at what was
      // really under the cursor.
      if (e.timeStamp - lastBodyPress.current < BODY_PRESS_MS) return;
      if ((e.target as HTMLElement).closest('[data-node-body]')) return;
      const point = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const hit = nodeAt(useGraphStore.getState().nodes, point, currentMetrics());
      if (hit) zoomToNode(hit);
    },
    [screenToFlowPosition, zoomToNode],
  );

  const onMouseDownCapture = useCallback((e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-node-body]')) lastBodyPress.current = e.timeStamp;
  }, []);

  const onNewIdea = useCallback(
    (nodeId: string) => {
      panToNode(useGraphStore.getState().addIdeaBranch(nodeId));
    },
    [panToNode],
  );

  const onNextChunk = useCallback(() => {
    void nextLessonChunk().then((chunkId) => panToNode(chunkId));
  }, [panToNode]);

  const onRegenerate = useCallback((nodeId: string) => {
    void reprompt(nodeId);
  }, []);

  const onDelete = useCallback((nodeId: string) => {
    useGraphStore.getState().deleteNode(nodeId);
  }, []);

  const onPrerequisite = useCallback(
    (nodeId: string) => {
      void prerequisiteChunk(nodeId).then((chunkId) => panToNode(chunkId));
    },
    [panToNode],
  );

  // The store is the single source of truth: position (drags), size (resizes)
  // and selection are applied back; structural changes always originate from
  // store actions. React Flow is controlled here, so anything we don't apply
  // simply never happens on screen — a dropped change leaves nodes unselectable
  // or frozen at their old size until the pointer is released.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const { setSelected } = useSelectionStore.getState();
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          setNodePosition(change.id, change.position);
        } else if (change.type === 'select') {
          setSelected(change.id, change.selected);
        } else if (change.type === 'dimensions' && change.dimensions && change.setAttributes) {
          // Live resize: the resizer streams dimensions while the pointer is
          // down, so applying them here is what makes the card follow the
          // cursor. `setAttributes` marks an authoritative resize — plain
          // measurement changes carry no such flag and must be ignored, or
          // every node would get pinned to its first measured height.
          setNodeSize(change.id, change.dimensions);
        }
      }
    },
    [setNodePosition, setNodeSize],
  );

  const onAct = useCallback(
    (active: ActiveSelection, intent: 'why' | 'respond' | 'video') => {
      window.getSelection()?.removeAllRanges();
      clearSelection();
      if (intent === 'video') {
        // The node appears when the search comes back — there is nothing to
        // compose in the meantime, so nothing is created up front. The card
        // says it is looking.
        void findVideoForHighlight(active.nodeId, active.sel).then((id) => {
          if (id) panToNode(id);
        });
        return;
      }
      panToNode(useGraphStore.getState().addWhyBranch(active.nodeId, active.sel, intent));
    },
    [clearSelection, panToNode],
  );

  return (
    <div
      className={styles.host}
      onMouseDownCapture={onMouseDownCapture}
      onDoubleClick={onDoubleClick}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeContextMenu={readOnly ? undefined : onNodeContextMenu}
        nodesDraggable={!readOnly}
        // React Flow's own a11y binds the arrow keys to MOVING the selected
        // node. Arrows here navigate between nodes instead, so its handler has
        // to go or every press would drag the card a few pixels.
        disableKeyboardA11y
        // React Flow's pane doubles the zoom on a double-click, from a native
        // listener that runs before React's — so it would fire alongside the
        // focus below. Double-click now means exactly one thing.
        zoomOnDoubleClick={false}
        fitView
        minZoom={0.1}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Lines} color="var(--grid)" gap={32} />
        <MiniMap pannable zoomable nodeColor="var(--grid)" maskColor="rgb(18 32 46 / 0.08)" />
        <Controls />
      </ReactFlow>
      {selection && !readOnly && <WhyButton selection={selection} onAct={onAct} />}
      {menu && !readOnly && (
        <NodeContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onNewIdea={onNewIdea}
          onNextChunk={onNextChunk}
          onRegenerate={onRegenerate}
          onDelete={onDelete}
          onPrerequisite={onPrerequisite}
        />
      )}
    </div>
  );
}
