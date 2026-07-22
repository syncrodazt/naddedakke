import { ReactFlow, Background, Controls, MiniMap, BackgroundVariant } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { nodeTypes } from './nodes/nodeTypes';

type CanvasProps = {
  nodes: Node[];
  edges: Edge[];
};

export function Canvas({ nodes, edges }: CanvasProps) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
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
