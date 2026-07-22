import { useCallback } from 'react';
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

type CanvasProps = {
  nodes: Node[];
  edges: Edge[];
};

export function Canvas({ nodes, edges }: CanvasProps) {
  const setNodePosition = useGraphStore((s) => s.setNodePosition);

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

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Lines} color="var(--grid)" gap={32} />
      <MiniMap pannable zoomable nodeColor="var(--grid)" maskColor="rgb(18 32 46 / 0.08)" />
      <Controls />
    </ReactFlow>
  );
}
