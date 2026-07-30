import type { RNode } from '../model/types';
import { displayContent, type DisplayContent } from '../model/content';
import { useGraphStore } from './graphStore';

/**
 * The body and highlights of a node as the learner currently reads it.
 *
 * Every node component goes through this rather than touching `content.md`, so
 * "read this notebook in Thai" is one setting rather than a change at every
 * render site. `displayContent` is cached per (content, language), so the
 * returned arrays keep their identity and MarkdownContent's memo survives.
 */
export function useDisplayContent(node: RNode): DisplayContent {
  const lang = useGraphStore((s) => s.session?.contentLang);
  return displayContent(node.content, lang);
}

/** Same, for code outside React (selection mapping, prompt context). */
export function currentDisplay(node: RNode): DisplayContent {
  return displayContent(node.content, useGraphStore.getState().session?.contentLang);
}
