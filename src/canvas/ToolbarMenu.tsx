import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './ToolbarMenu.module.css';

export type MenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Rendered in the trigger and beside the label when this item is current. */
  active?: boolean;
};

type ToolbarMenuProps = {
  /** What the closed button shows — kept short, this is a crowded strip. */
  trigger: ReactNode;
  title: string;
  items: MenuItem[];
  align?: 'left' | 'right';
};

/**
 * A button that opens a small list. The toolbar had every action laid out flat,
 * which pushed labels onto two lines and made the strip hard to scan; the rare
 * ones live behind one of these instead.
 */
export function ToolbarMenu({ trigger, title, items, align = 'left' }: ToolbarMenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      // A click inside is handled by the item itself.
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className={styles.wrap} ref={wrap}>
      <button
        type="button"
        className={open ? styles.triggerOpen : styles.trigger}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open && (
        <span className={align === 'right' ? styles.menuRight : styles.menu} role="menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={item.active ? styles.itemActive : styles.item}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
