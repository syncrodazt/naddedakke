import { useLayoutEffect, useRef } from 'react';
import { useStrings } from '../i18n';
import { useShareStore } from './shareStore';
import styles from './GuestBanner.module.css';

/**
 * Standing in someone else's notebook.
 *
 * Always visible, never dismissible: which notebook you are in and whether your
 * changes reach anyone are exactly the things you must not have to remember.
 */
export function GuestBanner() {
  const strings = useStrings();
  const guest = useShareStore((s) => s.guest);
  const ref = useRef<HTMLDivElement>(null);

  // Publish the real rendered height, so anything anchored to the top of the
  // window (the toolbar) can clear it. Measured rather than hard-coded because
  // a long notebook title wraps at narrow widths.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const height = guest && ref.current ? ref.current.offsetHeight : 0;
    root.style.setProperty('--guest-banner-h', `${height}px`);
    return () => {
      root.style.removeProperty('--guest-banner-h');
    };
  }, [guest, strings]);

  if (!guest) return null;

  return (
    <div ref={ref} className={guest.canEdit ? styles.bannerEdit : styles.banner} role="status">
      <span className={styles.tag}>
        {guest.canEdit ? strings.guestEditing : strings.guestViewing}
      </span>
      <span className={styles.title}>{guest.title}</span>
      <span className={styles.note}>
        {guest.canEdit ? strings.guestEditNote : strings.guestViewNote}
      </span>
    </div>
  );
}
