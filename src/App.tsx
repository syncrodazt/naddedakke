import { useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './canvas/Canvas';
import { Toolbar } from './canvas/Toolbar';
import { DialogHost } from './canvas/DialogHost';
import { FallbackBanner } from './canvas/FallbackBanner';
import { GoalReview } from './canvas/GoalReview';
import { SyncIndicator } from './canvas/SyncIndicator';
import { MetricsBridge } from './canvas/MetricsBridge';
import { CanvasShortcuts } from './canvas/CanvasShortcuts';
import { CommandPalette } from './canvas/CommandPalette';
import { Library } from './library/Library';
import { NextUp } from './concepts/NextUp';
import { useLibraryStore } from './library/libraryStore';
import { Sidebar } from './library/Sidebar';
import appStyles from './App.module.css';
import { ShareDialog } from './share/ShareDialog';
import { GuestBanner } from './share/GuestBanner';
import { enterGuestFromUrl } from './share/guest';
import { useShareStore } from './share/shareStore';
import { SettingsDialog } from './canvas/SettingsDialog';
import { usePanelStore } from './store/panelStore';
import { useSelectionStore } from './canvas/selectionStore';
import { ReplayPanel } from './replay/ReplayPanel';
import { PlanPanel } from './lesson/PlanPanel';
import { usePlanStore } from './lesson/planStore';
import { useReplayStore } from './replay/replayStore';
import { useRevealStore } from './replay/revealStore';
import { useVisibilityStore } from './replay/visibilityStore';
import { revealVisible, visibleGraph } from './replay/visibility';
import { lastTouched } from './library/grouping';
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
  const view = useLibraryStore((s) => s.view);
  const guest = useShareStore((s) => s.guest);
  const sidebarOpen = useLibraryStore((s) => s.sidebarOpen);
  const planOpen = usePlanStore((s) => s.open);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Load the most recently touched notebook so the canvas has something to
      // show the moment one is opened — but stay on the library, which is the
      // screen that can answer "what was I working on?".
      //
      // Nothing is seeded for a first-time visitor: the library already lists
      // the example notebooks, so an empty one is an invitation rather than a
      // dead end, and no notebook appears that the learner did not choose.
      // A share link takes over completely: the visitor asked for one specific
      // notebook, and their own library is not what they came for.
      if (await enterGuestFromUrl(window.location.href)) {
        if (!cancelled) {
          useLibraryStore.getState().show('canvas');
          setReady(true);
        }
        return;
      }
      const rows = await db.sessions.toArray();
      if (cancelled) return;
      const latest = rows.sort((a, b) => lastTouched(b) - lastTouched(a))[0];
      if (latest) await useGraphStore.getState().loadSession(latest.id);
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
        // A guest has exactly one notebook; there is nothing to switch to.
        if (useShareStore.getState().guest) return;
        usePanelStore.getState().toggle('palette');
      } else if (e.key === ',') {
        e.preventDefault();
        usePanelStore.getState().toggle('settings');
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        useLibraryStore.getState().toggleSidebar();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Leaving the canvas ends the replay. The panel unmounts with the screen, and
  // a replay still running behind the library would resume mid-way through when
  // you came back, from a cursor counted over a notebook you may have left.
  useEffect(() => {
    if (view !== 'canvas' && replayActive) useReplayStore.getState().exit();
  }, [view, replayActive]);

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

  // The library is a full screen, not an overlay: it replaces the canvas rather
  // than floating over it, so nothing behind it keeps running.
  if (view === 'next') {
    return (
      <>
        <NextUp />
        <SettingsDialog />
        <DialogHost />
      </>
    );
  }

  if (view === 'library') {
    return (
      // The provider is here only so the palette can share one implementation
      // across both screens: it calls fitView, which needs a React Flow
      // context even when there is no canvas to fit yet.
      <ReactFlowProvider>
        <Library />
        <CommandPalette />
        <SettingsDialog />
        <ShareDialog />
        <DialogHost />
      </ReactFlowProvider>
    );
  }

  return (
    <ReactFlowProvider>
      <MetricsBridge />
      <CanvasShortcuts readOnly={replayActive || guest?.canEdit === false} />
      <GuestBanner />
      <div className={appStyles.shell}>
        {/* A guest holds exactly one notebook; a list of "others" would be
            their own, which is not what this screen is about. */}
        {sidebarOpen && !guest && !replayActive && <Sidebar />}
        <div className={appStyles.main}>
          <Toolbar />
          <Canvas
            nodes={flowNodes}
            edges={flowEdges}
            readOnly={replayActive || guest?.canEdit === false}
          />
        </div>
        {/* A real flex child, not an overlay: the canvas has to keep the space
            it is actually given, or replay would centre nodes underneath the
            track list. */}
        {/* One right-hand slot, and replay wins it: while replaying, the plan
            would describe a lesson that is being re-shown a node at a time. */}
        {replayActive ? <ReplayPanel /> : planOpen && <PlanPanel />}
      </div>
      <FallbackBanner />
      <SyncIndicator />
      <CommandPalette />
      <SettingsDialog />
      <ShareDialog />
      <DialogHost />
      <GoalReview />
    </ReactFlowProvider>
  );
}

export default App;
