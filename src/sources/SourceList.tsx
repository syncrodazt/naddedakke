import type { Source } from '../model/types';
import { useStrings } from '../i18n';
import { displayHost, formatTime } from './url';
import styles from './SourceList.module.css';

const GLYPH: Record<Source['kind'], string> = {
  paper: '📄',
  repo: '⌥',
  video: '▶',
  web: '↗',
};

type Props = {
  sources: Source[];
  /** Open a video here on the canvas instead of leaving for YouTube. */
  onWatch?: (source: Source) => void;
};

/**
 * What is behind the words in a node.
 *
 * Deliberately plain and small. These are footnotes, not content: they sit
 * under the passage, they say where they go before you click, and they never
 * compete with the lesson for attention. The domain is always shown, because
 * "who says so" is most of what a citation is for.
 */
export function SourceList({ sources, onWatch }: Props) {
  const strings = useStrings();
  if (sources.length === 0) return null;

  return (
    <ul className={styles.list}>
      {sources.map((s) => (
        <li key={s.id} className={styles.item}>
          <span className={styles.glyph} aria-hidden>
            {GLYPH[s.kind]}
          </span>
          <span className={styles.body}>
            <a
              className={styles.link}
              href={s.url}
              target="_blank"
              // noopener because the opened page must not get a handle on this
              // one; noreferrer because where someone is studying is theirs.
              rel="noopener noreferrer"
              // nodrag/nopan or React Flow swallows the click to pan the canvas.
              onClick={(e) => e.stopPropagation()}
            >
              {s.title}
            </a>
            <span className={styles.meta}>
              <span className={styles.host}>{displayHost(s.url)}</span>
              {s.at !== undefined && <span className={styles.at}>{formatTime(s.at)}</span>}
              {/* A link the model recalled and a link it found are different
                  objects. Only one of them is evidence, so only one is left
                  unlabelled. */}
              {!s.searched && <span className={styles.unverified}>{strings.sourceUnverified}</span>}
            </span>
            {s.note !== undefined && <span className={styles.note}>{s.note}</span>}
          </span>
          {s.videoId !== undefined && onWatch && (
            <button
              type="button"
              className={`${styles.watch} nodrag`}
              title={strings.watchHere}
              onClick={(e) => {
                e.stopPropagation();
                onWatch(s);
              }}
            >
              ▶
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
