import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../store/selectors';
import { useStrings } from '../i18n';
import { MarkdownContent } from '../markdown/MarkdownContent';
import { useGraphStore } from '../store/graphStore';
import { useDisplayContent } from '../store/displayContent';
import { NodeShell } from '../canvas/nodes/NodeShell';
import { useResolvedHighlights } from '../canvas/nodes/useResolvedHighlights';
import { useCameraNav } from '../canvas/useCameraNav';
import { buildSrcDoc, readVisualMessage } from './sandbox';
import { loadThree } from './three';
import { regenerateVisual } from './generate';
import { useVisualStore } from './visualStore';
import styles from './VisualNode.module.css';

const DEFAULT_HEIGHT = 260;

/**
 * A generated figure, running on the canvas.
 *
 * The iframe carries `sandbox="allow-scripts"` and NOT `allow-same-origin`, so
 * the document inside has an opaque origin: its script cannot reach this page,
 * its storage, or the learner's session, and the CSP in the document forbids
 * every form of network access. That pairing is what makes it safe to run code
 * a model wrote, and it is the arrangement CLAUDE.md specified before any of
 * this existed.
 */
export function VisualNode({ data, selected }: NodeProps<RFlowNode>) {
  const strings = useStrings();
  const { node, displayNum } = data;
  const visual = node.visual;
  const { panToNode } = useCameraNav();
  const frameRef = useRef<HTMLIFrameElement>(null);

  // What the running figure reported, tagged with WHICH document reported it.
  // Regenerating swaps the document, and last run's error must not linger over
  // the new one — deriving that from the tag beats resetting it in an effect.
  const [report, setReport] = useState<{
    doc: string | null;
    error: string | null;
    height: number;
  }>({ doc: null, error: null, height: DEFAULT_HEIGHT });
  const [threeSource, setThreeSource] = useState<string | null>(null);
  const busy = useVisualStore((s) => s.workingOn === node.id);

  const display = useDisplayContent(node);
  const resolvedIds = useResolvedHighlights(display.highlights);

  // three.js is a 700KB chunk. It is fetched only when a figure actually
  // references THREE, so a notebook full of 2D figures never pays for it.
  const needsThree = visual?.three === true;
  useEffect(() => {
    if (!needsThree) return;
    let live = true;
    void loadThree().then((src) => {
      if (live) setThreeSource(src);
    });
    return () => {
      live = false;
    };
  }, [needsThree]);
  const library = needsThree ? threeSource : null;

  // Rebuilding the document remounts the iframe and re-runs the figure, so it
  // must change only when the figure or its library does.
  const srcDoc = useMemo(() => {
    if (!visual) return null;
    if (needsThree && library === null) return null; // still fetching
    return buildSrcDoc(visual.html, library === null ? {} : { library });
  }, [visual, needsThree, library]);

  const error = report.doc === srcDoc ? report.error : null;
  const height = report.doc === srcDoc ? report.height : DEFAULT_HEIGHT;

  // Read inside the message handler without re-subscribing on every rebuild.
  const docRef = useRef(srcDoc);
  useEffect(() => {
    docRef.current = srcDoc;
  }, [srcDoc]);

  // The sandbox posts as origin "null", so identity is established by the
  // message coming from THIS iframe's window rather than by its origin.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== frameRef.current?.contentWindow) return;
      const msg = readVisualMessage(e.data);
      if (!msg) return;
      setReport((prev) => {
        const doc = docRef.current;
        const base = prev.doc === doc ? prev : { doc, error: null, height: DEFAULT_HEIGHT };
        return msg.kind === 'error'
          ? { ...base, doc, error: msg.message }
          : { ...base, doc, height: msg.height };
      });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const onHighlightClick = useCallback(
    (highlightId: string) => {
      const child = display.highlights.find((h) => h.id === highlightId)?.childNodeId;
      if (child) panToNode(child);
    },
    [display, panToNode],
  );

  const addIdea = useCallback(() => {
    panToNode(useGraphStore.getState().addIdeaBranch(node.id));
  }, [node.id, panToNode]);

  return (
    <NodeShell
      nodeId={node.id}
      displayNum={displayNum}
      selected={selected}
      label={busy ? strings.visualWorking : strings.visualLabel}
      accent="alias"
      showUnderstood
      onAddIdea={addIdea}
    >
      {srcDoc !== null ? (
        <iframe
          ref={frameRef}
          className={`${styles.frame} nodrag nowheel`}
          style={{ height }}
          title={visual?.title ?? strings.visualLabel}
          // allow-scripts WITHOUT allow-same-origin. Adding same-origin here
          // would hand the figure this page's origin and undo the whole thing.
          sandbox="allow-scripts"
          srcDoc={srcDoc}
        />
      ) : (
        <p className={styles.loading}>{strings.visualLoading}</p>
      )}

      {error !== null && (
        // Shown, not swallowed: generated code fails often, and a silent blank
        // box gives the learner nothing to act on.
        <p className={styles.error} title={error}>
          {strings.visualBroken} <span className={styles.detail}>{error}</span>
        </p>
      )}

      <button
        type="button"
        className={`${styles.again} nodrag`}
        disabled={busy}
        onClick={() => void regenerateVisual(node.id)}
      >
        {strings.visualAgain}
      </button>

      <MarkdownContent
        nodeId={node.id}
        md={display.md}
        highlights={display.highlights}
        resolvedHighlightIds={resolvedIds}
        onHighlightClick={onHighlightClick}
      />
    </NodeShell>
  );
}
