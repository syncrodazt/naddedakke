import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { Session } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useReplayStore } from '../replay/replayStore';
import { exportSession, validateImport } from '../db/exportImport';
import { fireFixture } from '../gyakusan/fireFixture';
import { nextLessonChunk, startLesson } from '../services/lesson';
import { useModelStore } from '../store/modelStore';
import { useCameraNav } from './useCameraNav';
import { db } from '../db/db';
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
  const fileInput = useRef<HTMLInputElement>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const { fitView } = useReactFlow();
  const { panToNode } = useCameraNav();

  async function handleNewLesson() {
    const topic = window.prompt(strings.topicPrompt)?.trim();
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
  }, [session?.id, session?.title]);

  async function switchSession(id: string) {
    await useGraphStore.getState().loadSession(id);
    void fitView({ duration: 500 });
  }

  async function openFireDemo() {
    const existing = await db.sessions.get(fireFixture.session.id);
    if (existing) {
      await useGraphStore.getState().loadSession(existing.id);
    } else {
      // applyImport resolves after the Dexie flush, so the list refresh
      // below is guaranteed to see the new session.
      await useGraphStore.getState().applyImport(fireFixture);
      await refreshSessions();
    }
    void fitView({ duration: 500 });
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
      if (existing && !window.confirm(strings.overwriteConfirm)) return;
      await useGraphStore.getState().applyImport(payload);
    } catch (err) {
      window.alert(`${strings.importFailed}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div className={styles.toolbar}>
      <select
        className={styles.sessionSelect}
        value={session?.id ?? ''}
        onChange={(e) => void switchSession(e.target.value)}
      >
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title || s.id}
          </option>
        ))}
      </select>
      <button type="button" className={styles.button} onClick={() => void handleNewLesson()}>
        ＋ {strings.newLesson}
      </button>
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
      <button type="button" className={styles.button} onClick={startReplay} disabled={!session}>
        ▶ {strings.replay}
      </button>
      <button type="button" className={styles.button} onClick={() => void openFireDemo()}>
        {strings.fireDemo}
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
    </div>
  );
}
