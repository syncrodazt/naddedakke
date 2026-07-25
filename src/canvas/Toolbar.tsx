import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { Session } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useReplayStore } from '../replay/replayStore';
import { useRevealStore } from '../replay/revealStore';
import { sortedBySeq } from '../replay/visibility';
import { exportSession, validateImport } from '../db/exportImport';
import { examples } from '../fixture/examples';
import { nextLessonChunk, startLesson } from '../services/lesson';
import { useModelStore } from '../store/modelStore';
import { useAuthStore } from '../store/authStore';
import { useCameraNav } from './useCameraNav';
import { AuthPanel } from './AuthPanel';
import { db } from '../db/db';
import { alertDialog, confirmDialog, promptDialog } from '../store/uiStore';
import { strings } from '../strings';
import styles from './Toolbar.module.css';

export function Toolbar() {
  const session = useGraphStore((s) => s.session);
  const streaming = useGraphStore((s) => s.streamingNodeId !== null);
  const lessonComplete = useGraphStore((s) => s.lessonComplete);
  const startReplay = useReplayStore((s) => s.start);
  const nodes = useGraphStore((s) => s.nodes);
  const models = useModelStore((s) => s.available);
  const selectedModel = useModelStore((s) => s.selected);
  const setModel = useModelStore((s) => s.setSelected);
  // A cloud login pulls other devices' sessions into Dexie; refresh the list.
  const syncNonce = useAuthStore((s) => s.syncNonce);
  // Re-learn progressive-reveal state.
  const revealActive = useRevealStore((s) => s.active);
  const revealCount = useRevealStore((s) => s.count);
  const revealBaseSeq = useRevealStore((s) => s.baseSeq);
  const fileInput = useRef<HTMLInputElement>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const { fitView } = useReactFlow();
  const { panToNode } = useCameraNav();

  // Built-in examples not yet loaded as sessions (once loaded they live in the
  // Sessions group instead — so the single dropdown never shows a duplicate).
  const unloadedExamples = examples.filter((ex) => !sessions.some((s) => s.id === ex.id));
  // Original nodes for the reveal counter (nodes present when reveal began).
  const revealTotal = revealActive
    ? Object.values(nodes).filter((n) => n.seq <= revealBaseSeq).length
    : 0;

  async function handleNewLesson() {
    const topic = (await promptDialog(strings.topicPrompt, '', strings.topicPlaceholder))?.trim();
    if (!topic) return;
    const chunkId = await startLesson(topic);
    await refreshSessions();
    panToNode(chunkId);
  }

  async function handleNextChunk() {
    const chunkId = await nextLessonChunk();
    panToNode(chunkId);
  }

  function handleTidy() {
    useGraphStore.getState().tidyLayout();
    // Let the position updates flush to React Flow before fitting.
    window.setTimeout(() => void fitView({ duration: 500 }), 60);
  }

  // Learn-mode understanding progress: understood nodes / total content nodes.
  const learnNodes = Object.values(nodes).filter(
    (n) => n.kind === 'chunk' || n.kind === 'question' || n.kind === 'answer',
  );
  const understoodCount = learnNodes.filter((n) => n.understood).length;

  async function refreshSessions() {
    setSessions(await db.sessions.orderBy('createdAt').toArray());
  }

  useEffect(() => {
    void refreshSessions();
  }, [session?.id, session?.title, syncNonce]);

  // The single project dropdown routes to a saved session or a fresh example.
  async function handleSelect(value: string) {
    if (!value) return;
    if (sessions.some((s) => s.id === value)) await switchSession(value);
    else await loadExample(value);
  }

  async function switchSession(id: string) {
    useRevealStore.getState().showAll();
    await useGraphStore.getState().loadSession(id);
    void fitView({ duration: 500 });
  }

  async function loadExample(exampleId: string) {
    const example = examples.find((ex) => ex.id === exampleId);
    if (!example) return;
    useRevealStore.getState().showAll();
    const existing = await db.sessions.get(example.id);
    if (existing) {
      await useGraphStore.getState().loadSession(existing.id);
    } else {
      // applyImport resolves after the Dexie flush, so the refresh below is
      // guaranteed to see the new session.
      await useGraphStore.getState().applyImport(example.data);
      await refreshSessions();
    }
    void fitView({ duration: 500 });
  }

  // Re-learn: ask whether to show the whole graph or reveal from the first node.
  async function handleRelearn() {
    if (!session) return;
    const fromFirst = await confirmDialog(strings.relearnPrompt, {
      okLabel: strings.relearnFromFirst,
      cancelLabel: strings.relearnShowAll,
    });
    if (!fromFirst) {
      useRevealStore.getState().showAll();
      void fitView({ duration: 500 });
      return;
    }
    useRevealStore.getState().begin(session.seqCounter);
    const first = sortedBySeq(useGraphStore.getState().nodes)[0];
    if (first) window.setTimeout(() => panToNode(first.id), 60);
  }

  function handleRevealNext() {
    const base = useRevealStore.getState().baseSeq;
    const original = sortedBySeq(useGraphStore.getState().nodes).filter((n) => n.seq <= base);
    const count = useRevealStore.getState().count;
    if (count >= original.length) return;
    useRevealStore.getState().next();
    const newly = original[count]; // 0-based index `count` = the newly revealed node
    if (newly) panToNode(newly.id);
  }

  function handleExport() {
    const { session, nodes, edges } = useGraphStore.getState();
    if (!session) return;
    const payload = exportSession(session, nodes, edges);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.title || 'session'}-${session.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    try {
      const payload = validateImport(JSON.parse(await file.text()));
      const existing = await db.sessions.get(payload.session.id);
      if (existing && !(await confirmDialog(strings.overwriteConfirm))) return;
      await useGraphStore.getState().applyImport(payload);
    } catch (err) {
      await alertDialog(
        `${strings.importFailed}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return (
    <div className={styles.toolbar}>
      <select
        className={styles.sessionSelect}
        value={session?.id ?? ''}
        onChange={(e) => void handleSelect(e.target.value)}
      >
        <optgroup label={strings.sessionsGroup}>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title || s.id}
            </option>
          ))}
        </optgroup>
        {unloadedExamples.length > 0 && (
          <optgroup label={strings.examplesGroup}>
            {unloadedExamples.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <button type="button" className={styles.button} onClick={() => void handleNewLesson()}>
        ＋ {strings.newLesson}
      </button>
      {session && !revealActive && (
        <button type="button" className={styles.button} onClick={() => void handleRelearn()}>
          {strings.relearn}
        </button>
      )}
      {revealActive && (
        <>
          <button
            type="button"
            className={styles.button}
            onClick={handleRevealNext}
            disabled={revealCount >= revealTotal}
          >
            {strings.revealNext} {Math.min(revealCount, revealTotal)}/{revealTotal}
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              useRevealStore.getState().showAll();
              void fitView({ duration: 500 });
            }}
          >
            {strings.revealShowAll}
          </button>
        </>
      )}
      {session?.mode === 'learn' && !lessonComplete && (
        <button
          type="button"
          className={styles.button}
          onClick={() => void handleNextChunk()}
          disabled={streaming}
        >
          {strings.nextChunk} →
        </button>
      )}
      {session?.mode === 'learn' && (
        <button type="button" className={styles.button} onClick={handleTidy}>
          {strings.tidy}
        </button>
      )}
      {session?.mode === 'learn' && learnNodes.length > 0 && (
        <span className={styles.progress} title={strings.understoodTitle}>
          ✓ {strings.understoodProgress} {understoodCount}/{learnNodes.length}
        </span>
      )}
      <button
        type="button"
        className={styles.button}
        onClick={() => {
          useRevealStore.getState().showAll();
          startReplay();
        }}
        disabled={!session}
      >
        ▶ {strings.replay}
      </button>
      <button type="button" className={styles.button} onClick={handleExport} disabled={!session}>
        {strings.exportSession}
      </button>
      <button type="button" className={styles.button} onClick={() => fileInput.current?.click()}>
        {strings.importSession}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportFile(file);
          e.target.value = '';
        }}
      />
      <label className={styles.modelPicker} title={strings.modelLabel}>
        <span className={styles.modelIcon}>🤖</span>
        <select
          className={styles.modelSelect}
          value={selectedModel}
          onChange={(e) => setModel(e.target.value)}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <AuthPanel />
    </div>
  );
}
