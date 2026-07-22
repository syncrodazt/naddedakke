import { useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './canvas/Canvas';
import { Toolbar } from './canvas/Toolbar';
import { fixture } from './fixture/fixture';
import { db } from './db/db';
import { useGraphStore } from './store/graphStore';
import { toFlowEdge, toFlowNode } from './store/selectors';

function App() {
  const [ready, setReady] = useState(false);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const latest = await db.sessions.orderBy('createdAt').last();
      if (cancelled) return;
      if (latest) {
        await useGraphStore.getState().loadSession(latest.id);
      } else {
        await useGraphStore.getState().applyImport(fixture);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const flowNodes = useMemo(() => Object.values(nodes).map(toFlowNode), [nodes]);
  const flowEdges = useMemo(() => Object.values(edges).map(toFlowEdge), [edges]);

  if (!ready) return null;

  return (
    <ReactFlowProvider>
      <Toolbar />
      <Canvas nodes={flowNodes} edges={flowEdges} />
    </ReactFlowProvider>
  );
}

export default App;
