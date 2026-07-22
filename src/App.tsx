import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './canvas/Canvas';
import { fixture } from './fixture/fixture';
import { toFlowEdge, toFlowNode } from './store/selectors';

const nodes = fixture.nodes.map(toFlowNode);
const edges = fixture.edges.map(toFlowEdge);

function App() {
  return (
    <ReactFlowProvider>
      <Canvas nodes={nodes} edges={edges} />
    </ReactFlowProvider>
  );
}

export default App;
