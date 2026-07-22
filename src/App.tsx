import { useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './canvas/Canvas';
import { Toolbar } from './canvas/Toolbar';
import { ReplayBar } from './replay/ReplayBar';
import { useReplayStore } from './replay/replayStore';
import { visibleGraph } from './replay/visibility';
import { fixture } from './fixture/fixture';
import { db } from './db/db';
import { useGraphStore } from './store/graphStore';
import { toFlowEdge, toFlowNode } from './store/selectors';

function App() {
  const [ready, setReady] = useState(false);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const replayActive = useReplayStore((s) => s.active);
  const replayCursor = useReplayStore((s) => s.cursor);

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

  const flowNodes = useMemo(() => {
    const all = Object.values(nodes);
    if (!replayActive) return all.map(toFlowNode);
    const { nodeIds } = visibleGraph(nodes, edges, replayCursor);
    return all.filter((n) => nodeIds.has(n.id)).map(toFlowNode);
  }, [nodes, edges, replayActive, replayCursor]);

  const flowEdges = useMemo(() => {
    const all = Object.values(edges);
    if (!replayActive) return all.map(toFlowEdge);
    const { edgeIds } = visibleGraph(nodes, edges, replayCursor);
    return all.filter((e) => edgeIds.has(e.id)).map(toFlowEdge);
  }, [nodes, edges, replayActive, replayCursor]);

  if (!ready) return null;

  return (
    <ReactFlowProvider>
      <Toolbar />
      <Canvas nodes={flowNodes} edges={flowEdges} readOnly={replayActive} />
      {replayActive && <ReplayBar />}
    </ReactFlowProvider>
  );
}

export default App;
