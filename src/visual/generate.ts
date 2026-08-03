import type { RNode, VisualRef } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { currentDisplay } from '../store/displayContent';
import { isAbort, useLlmStore } from '../store/llmStore';
import { mockService, teachService } from '../services/claude';
import { langLabel } from '../i18n/langLabel';
import { parseVisual } from './parse';
import { useVisualStore } from './visualStore';

// Making a figure, and remaking one that came out broken.
//
// Unlike sources, falling back to the mock here is honest: a canned figure
// claims nothing about the world, it is visibly labelled, and it is the same
// kind of offline stand-in as a mock lesson chunk.

async function requestVisual(node: RNode, quotedText?: string): Promise<VisualRef | null> {
  const session = useGraphStore.getState().session;
  if (!session) return null;

  const llm = useLlmStore.getState();
  const req = {
    topic: session.title,
    passageMd: currentDisplay(node).md,
    langLabel: langLabel(),
    ...(quotedText === undefined ? {} : { quotedText }),
    allow3d: true,
    signal: llm.begin(),
  };
  try {
    let raw: string;
    try {
      raw = await teachService.makeVisual(req);
    } catch (err) {
      if (isAbort(err)) return null;
      llm.noteFallback(err);
      raw = await mockService.makeVisual(req);
    }
    const visual = parseVisual(raw, session.title);
    return { title: visual.title, html: visual.html, three: visual.three };
  } catch (err) {
    if (!isAbort(err)) useLlmStore.getState().noteFallback(err);
    return null;
  } finally {
    useLlmStore.getState().end();
  }
}

/** A figure for a whole node, hung below it. */
export async function makeVisualFor(nodeId: string): Promise<string | null> {
  const node = useGraphStore.getState().nodes[nodeId];
  if (!node) return null;
  useVisualStore.getState().begin(nodeId);
  try {
    const visual = await requestVisual(node);
    return visual === null ? null : useGraphStore.getState().addVisual(nodeId, visual);
  } finally {
    useVisualStore.getState().end();
  }
}

/** A figure for the highlighted phrase, branched off it like a なんで？. */
export async function makeVisualForHighlight(
  nodeId: string,
  sel: { start: number; end: number; text: string; lang?: string },
): Promise<string | null> {
  const node = useGraphStore.getState().nodes[nodeId];
  if (!node) return null;
  useVisualStore.getState().begin(nodeId);
  try {
    const visual = await requestVisual(node, sel.text);
    return visual === null ? null : useGraphStore.getState().addVisualBranch(nodeId, sel, visual);
  } finally {
    useVisualStore.getState().end();
  }
}

/**
 * Try again on a figure that came out wrong, in place.
 *
 * The node survives, so its seq, its position in the replay and anything
 * branched off it are untouched. It asks the parent — the node the figure was
 * made for — rather than the figure's own caption, which is just its title.
 */
export async function regenerateVisual(visualNodeId: string): Promise<void> {
  const { nodes, edges } = useGraphStore.getState();
  const incoming = Object.values(edges).find((e) => e.target === visualNodeId);
  const parent = incoming ? nodes[incoming.source] : undefined;
  const subject = parent ?? nodes[visualNodeId];
  if (!subject) return;

  useVisualStore.getState().begin(visualNodeId);
  try {
    const visual = await requestVisual(subject);
    if (visual) useGraphStore.getState().replaceVisual(visualNodeId, visual);
  } finally {
    useVisualStore.getState().end();
  }
}
