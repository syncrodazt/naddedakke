import { useRef } from 'react';
import { useGraphStore } from '../store/graphStore';
import { exportSession, validateImport } from '../db/exportImport';
import { db } from '../db/db';
import { strings } from '../strings';
import styles from './Toolbar.module.css';

export function Toolbar() {
  const session = useGraphStore((s) => s.session);
  const fileInput = useRef<HTMLInputElement>(null);

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
      <span className={styles.title}>{session ? session.title : strings.appTitle}</span>
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
    </div>
  );
}
