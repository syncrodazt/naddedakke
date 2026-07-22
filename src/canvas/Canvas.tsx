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
import { nextLessonChunk } from '../services/lesson';

type CanvasProps = {
  nodes: Node[];
  edges: Edge[];
  /** Replay mode: no dragging, no new branches. */
  readOnly?: boolean;
};

export function Canvas({ nodes, edges, readOnly = false }: CanvasProps) {
  const setNodePosition = useGraphStore((s) => s.setNodePosition);
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

  // The store is the single source of truth: only position changes (drags) are
  // applied back; structural changes always originate from store actions.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          setNodePosition(change.id, change.position);
        }
      }
    },
    [setNodePosition],
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
        />
      )}
    </>
  );
}
