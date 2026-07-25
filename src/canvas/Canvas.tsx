import { useCallback, useState, type MouseEvent } from 'react';
import {
  ReactFlow,
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
import { useTextSelection, type ActiveSelection } from './useTextSelection';
import { useCameraNav } from './useCameraNav';
import { WhyButton } from './WhyButton';
import { NodeContextMenu, type MenuState } from './NodeContextMenu';
import { useSelectionStore } from './selectionStore';
import { nextLessonChunk } from '../services/lesson';
import { reprompt } from '../services/reprompt';

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
  const { panToNode } = useCameraNav();
  const [menu, setMenu] = useState<MenuState | null>(null);

  const onNodeContextMenu = useCallback((e: MouseEvent, node: Node) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
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
    (active: ActiveSelection, intent: 'why' | 'respond') => {
      const questionId = useGraphStore.getState().addWhyBranch(active.nodeId, active.sel, intent);
      window.getSelection()?.removeAllRanges();
      clearSelection();
      panToNode(questionId);
    },
    [clearSelection, panToNode],
  );

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeContextMenu={readOnly ? undefined : onNodeContextMenu}
        nodesDraggable={!readOnly}
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
        />
      )}
    </>
  );
}
