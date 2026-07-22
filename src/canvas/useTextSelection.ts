import { useEffect, useState } from 'react';
import { mapRangeToSource, type MappedSelection } from '../markdown/selectionMapping';
import { useGraphStore } from '../store/graphStore';

export type ActiveSelection = {
  nodeId: string;
  sel: MappedSelection;
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
      const mapped = mapRangeToSource(container, node.content.md, range);
      if (!mapped || mapped.text.trim() === '') {
        setActive(null);
        return;
      }
      setActive({ nodeId, sel: mapped, rect: range.getBoundingClientRect() });
    }

    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, []);

  return [active, () => setActive(null)];
}
