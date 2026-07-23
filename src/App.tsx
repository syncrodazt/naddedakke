import { useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './canvas/Canvas';
import { Toolbar } from './canvas/Toolbar';
import { DialogHost } from './canvas/DialogHost';
import { ReplayBar } from './replay/ReplayBar';
import { useReplayStore } from './replay/replayStore';
import { visibleGraph } from './replay/visibility';
import { fixture } from './fixture/fixture';
import { db } from './db/db';
import { useGraphStore } from './store/graphStore';
import { useModelStore } from './store/modelStore';
import { useAuthStore } from './store/authStore';
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
    void useModelStore.getState().loadModels();
    // Wire up cloud login/sync (a no-op unless Supabase env vars are set).
    useAuthStore.getState().init();
    return () => {
      cancelled = true;
    };
  }, []);

  // Rank each node 1..N by seq so the visible #N badge stays contiguous even
  // after deletes (seq itself never renumbers). Computed over ALL nodes so a
  // node keeps the same number during replay.
  const rankMap = useMemo(() => {
    const m = new Map<string, number>();
    Object.values(nodes)
      .sort((a, b) => a.seq - b.seq)
      .forEach((n, i) => m.set(n.id, i + 1));
    return m;
  }, [nodes]);

  const flowNodes = useMemo(() => {
    const toFlow = (n: (typeof nodes)[string]) => toFlowNode(n, rankMap.get(n.id) ?? 0);
    const all = Object.values(nodes);
    if (!replayActive) return all.map(toFlow);
    const { nodeIds } = visibleGraph(nodes, edges, replayCursor);
    return all.filter((n) => nodeIds.has(n.id)).map(toFlow);
  }, [nodes, edges, replayActive, replayCursor, rankMap]);

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
      <DialogHost />
    </ReactFlowProvider>
  );
}

export default App;
