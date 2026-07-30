import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useGraphStore } from '../store/graphStore';
import { useReplayStore } from '../replay/replayStore';
import { useRevealStore } from '../replay/revealStore';
import { sortedBySeq } from '../replay/visibility';
import { exportSession, validateImport } from '../db/exportImport';
import { nextLessonChunk, startLesson } from '../services/lesson';
import { useAuthStore } from '../store/authStore';
import { pullFromCloud } from '../services/cloudSync';
import { useCameraNav } from './useCameraNav';
import { ToolbarMenu } from './ToolbarMenu';
import { db } from '../db/db';
import { alertDialog, confirmDialog, promptDialog } from '../store/uiStore';
import { redo, undo, useCanRedo, useCanUndo } from '../store/history';
import { useLlmStore } from '../store/llmStore';
import { decomposeGoal } from '../services/goal';
import { LANGS, useStrings } from '../i18n';
import { translateNotebook } from '../services/translate';
import { useTranslateStore } from '../store/translateStore';
import { usePanelStore } from '../store/panelStore';
import type { LayoutDirection } from '../layout/layout';
import styles from './Toolbar.module.css';

export function Toolbar() {
  const strings = useStrings();
  const session = useGraphStore((s) => s.session);
  const streaming = useGraphStore((s) => s.streamingNodeId !== null);
  const lessonComplete = useGraphStore((s) => s.lessonComplete);
  const startReplay = useReplayStore((s) => s.start);
  const nodes = useGraphStore((s) => s.nodes);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const cancelStream = useLlmStore((s) => s.cancel);
  const user = useAuthStore((s) => s.user);
  const [pulling, setPulling] = useState(false);
  // Re-learn progressive-reveal state.
  const revealActive = useRevealStore((s) => s.active);
  const revealCount = useRevealStore((s) => s.count);
  const revealBaseSeq = useRevealStore((s) => s.baseSeq);
  const contentLang = useGraphStore((s) => s.session?.contentLang);
  const translating = useTranslateStore((s) => s.active);
  const translateDone = useTranslateStore((s) => s.done);
  const translateTotal = useTranslateStore((s) => s.total);
  const fileInput = useRef<HTMLInputElement>(null);
  const { fitView, getNodes, getInternalNode } = useReactFlow();
  const { panToNode } = useCameraNav();

  // Original nodes for the reveal counter (nodes present when reveal began).
  const revealTotal = revealActive
    ? Object.values(nodes).filter((n) => n.seq <= revealBaseSeq).length
    : 0;

  async function handleNewLesson() {
    const topic = (await promptDialog(strings.topicPrompt, '', strings.topicPlaceholder))?.trim();
    if (!topic) return;
    const chunkId = await startLesson(topic);
    panToNode(chunkId);
  }

  // Pick up changes made outside this browser — another device, or the MCP
  // server writing on Claude's behalf. Cloud wins, so the open session is
  // reloaded from what was just pulled.
  async function handleCloudPull() {
    setPulling(true);
    try {
      const pulled = await pullFromCloud();
      if (pulled === null) {
        await alertDialog(strings.cloudPullFailed);
        return;
      }
      const openId = useGraphStore.getState().session?.id;
      if (openId) await useGraphStore.getState().loadSession(openId);
      await alertDialog(`${strings.cloudPulled} (${pulled})`);
    } finally {
      setPulling(false);
    }
  }

  // Back-cast: describe a goal, review the model's decomposition, then insert.
  async function handleBackcast() {
    const goal = (await promptDialog(strings.goalPrompt, '', strings.goalPlaceholder))?.trim();
    if (!goal) return;
    await decomposeGoal(goal);
  }

  // Reading language. The view switches immediately and bodies fill in behind
  // it, so picking a language never blocks on the slowest node.
  async function handleContentLang(lang: string | undefined) {
    if (lang === undefined) {
      useGraphStore.getState().setContentLang(undefined);
      return;
    }
    const summary = await translateNotebook(lang, LANGS.find((l) => l.id === lang)?.label ?? lang);
    if (summary && summary.failed > 0) await alertDialog(strings.translateFailed(summary.failed));
  }

  async function handleNextChunk() {
    const chunkId = await nextLessonChunk();
    panToNode(chunkId);
  }

  function handleTidy(direction: LayoutDirection) {
    // Feed Tidy the sizes React Flow measured on screen. Card heights are
    // driven by however much prose the model wrote, so laying out from an
    // estimate is what made tall cards overlap their branches.
    // Measured sizes live on the *internal* node — getNodes() hands back the
    // controlled nodes we passed in, whose `measured` is always empty.
    const metrics = Object.fromEntries(
      getNodes().map((n) => {
        const measured = getInternalNode(n.id)?.measured;
        return [n.id, { width: measured?.width, height: measured?.height }];
      }),
    );
    useGraphStore.getState().tidyLayout(metrics, direction);
    // Let the position updates flush to React Flow before fitting.
    window.setTimeout(() => void fitView({ duration: 500 }), 60);
  }

  // Understanding progress: understood nodes / total content nodes. Counts
  // gyakusan nodes too — the 分かった loop is the same system in every notebook.
  const learnNodes = Object.values(nodes).filter(
    (n) => n.kind !== 'playground' && n.kind !== 'video',
  );
  const understoodCount = learnNodes.filter((n) => n.understood).length;

  // Ctrl/⌘+Z to undo, +Shift (or Ctrl+Y) to redo — ignored while typing, so a
  // compose box keeps its own native undo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
      } else if (key === 'y') {
        e.preventDefault();
        void redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      // applyImport resolves after the Dexie flush, so the imported session is
      // now on disk — refresh so it appears (and is selected) in the dropdown.
    } catch (err) {
      await alertDialog(
        `${strings.importFailed}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return (
    <div className={styles.toolbar}>
      <button
        type="button"
        className={styles.project}
        title={strings.switchProject}
        onClick={() => usePanelStore.getState().open('palette')}
      >
        <span className={styles.projectName}>{session?.title ?? '—'}</span>
        <span className={styles.projectHint}>⌘K</span>
      </button>
      <button
        type="button"
        className={styles.button}
        title={strings.newLesson}
        onClick={() => void handleNewLesson()}
      >
        ＋
      </button>
      <span className={styles.undoGroup}>
        <button
          type="button"
          className={styles.button}
          onClick={() => void undo()}
          disabled={!canUndo}
          title={`${strings.undo} (Ctrl/⌘+Z)`}
        >
          ↶
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => void redo()}
          disabled={!canRedo}
          title={`${strings.redo} (Ctrl/⌘+Shift+Z)`}
        >
          ↷
        </button>
      </span>
      {streaming && (
        <button type="button" className={styles.stop} onClick={cancelStream}>
          {strings.stopStream}
        </button>
      )}
      <button
        type="button"
        className={styles.button}
        title={strings.backcast}
        onClick={() => void handleBackcast()}
      >
        🎯
      </button>
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
      {session && !lessonComplete && (
        <button
          type="button"
          className={styles.button}
          onClick={() => void handleNextChunk()}
          disabled={streaming}
        >
          {strings.nextChunk} →
        </button>
      )}
      {session && (
        <ToolbarMenu
          title={strings.tidy}
          trigger={`⤢ ${strings.tidy}`}
          items={[
            {
              key: 'horizontal',
              label: strings.tidyHorizontal,
              onSelect: () => handleTidy('horizontal'),
            },
            {
              key: 'vertical',
              label: strings.tidyVertical,
              onSelect: () => handleTidy('vertical'),
            },
          ]}
        />
      )}
      <button
        type="button"
        className={styles.button}
        title={strings.replay}
        onClick={() => {
          useRevealStore.getState().showAll();
          startReplay();
        }}
        disabled={!session}
      >
        ▶
      </button>
      {learnNodes.length > 0 && (
        <span className={styles.progress} title={strings.understoodTitle}>
          ✓ {understoodCount}/{learnNodes.length}
        </span>
      )}
      {translating && (
        <span className={styles.progress} title={strings.contentLangTitle}>
          🌐 {translateDone}/{translateTotal}
        </span>
      )}
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
      <ToolbarMenu
        title={strings.more}
        trigger="⋯"
        align="right"
        items={[
          ...(session && !revealActive
            ? [{ key: 'relearn', label: strings.relearn, onSelect: () => void handleRelearn() }]
            : []),
          ...(user
            ? [
                {
                  key: 'pull',
                  label: strings.cloudPull,
                  disabled: pulling,
                  onSelect: () => void handleCloudPull(),
                },
              ]
            : []),
          ...(session
            ? [
                {
                  key: 'lang-original',
                  label: `${strings.contentLangMenu} — ${strings.contentLangOriginal}`,
                  active: contentLang === undefined,
                  disabled: translating,
                  onSelect: () => void handleContentLang(undefined),
                },
                ...LANGS.map((l) => ({
                  key: `lang-${l.id}`,
                  label: `${strings.contentLangMenu} — ${l.label}`,
                  active: contentLang === l.id,
                  disabled: translating,
                  onSelect: () => void handleContentLang(l.id),
                })),
              ]
            : []),
          {
            key: 'export',
            label: strings.exportSession,
            disabled: !session,
            onSelect: handleExport,
          },
          {
            key: 'import',
            label: strings.importSession,
            onSelect: () => fileInput.current?.click(),
          },
        ]}
      />
      <button
        type="button"
        className={styles.button}
        title={strings.settingsTitle}
        onClick={() => usePanelStore.getState().open('settings')}
      >
        ⚙
      </button>
    </div>
  );
}
