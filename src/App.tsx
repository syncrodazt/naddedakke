import { useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './canvas/Canvas';
import { Toolbar } from './canvas/Toolbar';
import { DialogHost } from './canvas/DialogHost';
import { FallbackBanner } from './canvas/FallbackBanner';
import { GoalReview } from './canvas/GoalReview';
import { SyncIndicator } from './canvas/SyncIndicator';
import { MetricsBridge } from './canvas/MetricsBridge';
import { CommandPalette } from './canvas/CommandPalette';
import { SettingsDialog } from './canvas/SettingsDialog';
import { usePanelStore } from './store/panelStore';
import { useSelectionStore } from './canvas/selectionStore';
import { ReplayBar } from './replay/ReplayBar';
import { useReplayStore } from './replay/replayStore';
import { useRevealStore } from './replay/revealStore';
import { useVisibilityStore } from './replay/visibilityStore';
import { revealVisible, visibleGraph } from './replay/visibility';
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
  const revealActive = useRevealStore((s) => s.active);
  const revealBaseSeq = useRevealStore((s) => s.baseSeq);
  const revealCount = useRevealStore((s) => s.count);
  const selectedIds = useSelectionStore((s) => s.selected);

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

  // Ctrl/⌘+K switches notebook, Ctrl/⌘+, opens settings. Both work while
  // typing — they are how you leave what you are doing, not part of it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        usePanelStore.getState().toggle('palette');
      } else if (e.key === ',') {
        e.preventDefault();
        usePanelStore.getState().toggle('settings');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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

  // Replay (auto-play, read-only) takes precedence; re-learn reveal is the
  // interactive progressive view. Either one filters the visible set; otherwise
  // everything shows.
  const visible = useMemo(() => {
    if (replayActive) return visibleGraph(nodes, edges, replayCursor);
    if (revealActive) return revealVisible(nodes, edges, revealBaseSeq, revealCount);
    return null;
  }, [nodes, edges, replayActive, replayCursor, revealActive, revealBaseSeq, revealCount]);

  // Publish the filtered set so node components can tell what is on screen.
  // A node's look can depend on other nodes (a resolved highlight goes teal),
  // and reading that from the graph store alone would consult nodes replay has
  // not revealed yet.
  const setVisibleIds = useVisibilityStore((s) => s.setVisibleIds);
  useEffect(() => {
    setVisibleIds(visible?.nodeIds ?? null);
  }, [visible, setVisibleIds]);

  // toFlowNode is memoized per RNode, so unchanged nodes keep their object
  // identity here and React Flow leaves them alone (see store/selectors.ts).
  const flowNodes = useMemo(() => {
    const toFlow = (n: (typeof nodes)[string]) =>
      toFlowNode(n, rankMap.get(n.id) ?? 0, selectedIds.has(n.id));
    const all = Object.values(nodes);
    if (!visible) return all.map(toFlow);
    return all.filter((n) => visible.nodeIds.has(n.id)).map(toFlow);
  }, [nodes, visible, rankMap, selectedIds]);

  const flowEdges = useMemo(() => {
    const all = Object.values(edges);
    if (!visible) return all.map(toFlowEdge);
    return all.filter((e) => visible.edgeIds.has(e.id)).map(toFlowEdge);
  }, [edges, visible]);

  if (!ready) return null;

  return (
    <ReactFlowProvider>
      <MetricsBridge />
      <Toolbar />
      <Canvas nodes={flowNodes} edges={flowEdges} readOnly={replayActive} />
      <FallbackBanner />
      <SyncIndicator />
      {replayActive && <ReplayBar />}
      <CommandPalette />
      <SettingsDialog />
      <DialogHost />
      <GoalReview />
    </ReactFlowProvider>
  );
}

export default App;
