import { useEffect, useState } from 'react';
import { mapRangeToSource, type MappedSelection } from '../markdown/selectionMapping';
import { useGraphStore } from '../store/graphStore';
import { currentDisplay } from '../store/displayContent';

export type ActiveSelection = {
  nodeId: string;
  // `lang` records which body the offsets index: the learner may be reading a
  // translation, in which case the highlight belongs to that translation.
  sel: MappedSelection & { lang?: string };
  rect: DOMRect;
};

// Watches document selection; when a non-collapsed selection lives inside one
// node's rendered markdown and maps back to source offsets, exposes it so the
// floating なんで？ button can appear at the selection.
export function useTextSelection(): [ActiveSelection | null, () => void] {
  const [active, setActive] = useState<ActiveSelection | null>(null);

  useEffect(() => {
    function update() {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setActive(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const anchor =
        range.commonAncestorContainer instanceof Element
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
      const container = anchor?.closest<HTMLElement>('[data-node-id]');
      if (!container) {
        setActive(null);
        return;
      }
      const nodeId = container.dataset.nodeId!;
      const node = useGraphStore.getState().nodes[nodeId];
      if (!node) {
        setActive(null);
        return;
      }
      const display = currentDisplay(node);
      const mapped = mapRangeToSource(container, display.md, range);
      if (!mapped || mapped.text.trim() === '') {
        setActive(null);
        return;
      }
      setActive({
        nodeId,
        sel: { ...mapped, ...(display.bodyLang !== undefined ? { lang: display.bodyLang } : {}) },
        rect: range.getBoundingClientRect(),
      });
    }

    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, []);

  return [active, () => setActive(null)];
}
