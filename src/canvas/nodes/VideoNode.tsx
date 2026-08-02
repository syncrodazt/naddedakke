import { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { useStrings } from '../../i18n';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { useGraphStore } from '../../store/graphStore';
import { useDisplayContent } from '../../store/displayContent';
import { embedUrl, formatTime, watchUrl } from '../../sources/url';
import { useCameraNav } from '../useCameraNav';
import { NodeShell } from './NodeShell';
import { useResolvedHighlights } from './useResolvedHighlights';
import styles from './VideoNode.module.css';

/**
 * A video, on the canvas, starting at the part that matters.
 *
 * Text is the wrong medium for some things — a waveform, a mechanism moving, a
 * proof being drawn — and until now the app had only text. This is the escape
 * hatch, and it is a node like any other: it sits in seq order, it replays, and
 * its caption is markdown you can highlight and ask なんで？ about.
 *
 * The `src` is built by `embedUrl` from an id that has been matched against
 * YouTube's grammar, never from a string the model wrote. An iframe src is the
 * highest-consequence place a URL can land in this app, so the model's text
 * does not reach it.
 */
export function VideoNode({ data, selected }: NodeProps<RFlowNode>) {
  const strings = useStrings();
  const { node, displayNum } = data;
  const { panToNode } = useCameraNav();

  const display = useDisplayContent(node);
  const resolvedIds = useResolvedHighlights(display.highlights);
  const source = node.sources?.find((s) => s.videoId !== undefined);

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
      label={strings.videoLabel}
      accent="alias"
      showUnderstood
      onAddIdea={addIdea}
    >
      {source?.videoId !== undefined && (
        <div className={styles.frame}>
          <iframe
            className={styles.player}
            src={embedUrl(source.videoId, source.at)}
            title={source.title}
            // Only what a player needs. No same-origin, no top navigation:
            // an embed must not be able to move the page it is embedded in.
            sandbox="allow-scripts allow-same-origin allow-presentation"
            allow="accelerometer; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
          />
        </div>
      )}
      {source && (
        <p className={styles.meta}>
          <a
            className={styles.link}
            href={watchUrl(source.videoId!, source.at)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {strings.openOnYoutube}
          </a>
          {source.at !== undefined && <span className={styles.at}>{formatTime(source.at)}</span>}
        </p>
      )}
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
