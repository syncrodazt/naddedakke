import { newId } from '../model/ids';
import type { RNode, Source } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { currentDisplay } from '../store/displayContent';
import { isAbort, useLlmStore } from '../store/llmStore';
import { teachService } from '../services/claude';
import { langLabel } from '../i18n/langLabel';
import { getStrings } from '../i18n';
import { parseSources } from './parse';
import { useSourceStore } from './sourceStore';

// "Show me this" as a first-class gesture.
//
// Sources already carried videos, but reaching one meant asking for sources,
// waiting, and hoping a video row happened to appear — three steps and a
// gamble for what is usually a single, definite thought: I cannot picture this,
// let me watch it. Some things are simply the wrong shape for prose (a waveform
// moving, a mechanism turning, a proof being drawn), and the app should not
// make that the long way round.

/** The first source we can actually embed. Anything else is not "a video". */
function firstVideo(sources: Source[]): Source | null {
  return sources.find((s) => s.videoId !== undefined) ?? null;
}

/** The caption under the player: the title, and why this clip was picked. */
function captionFor(source: Source): string {
  return `**${source.title}**\n\n${source.note ?? ''}`.trim();
}

async function requestVideo(node: RNode, quotedText?: string): Promise<Source | null> {
  const session = useGraphStore.getState().session;
  if (!session) return null;

  const llm = useLlmStore.getState();
  useSourceStore.getState().begin(node.id);
  try {
    const { raw, searched } = await teachService.findSources({
      topic: session.title,
      passageMd: currentDisplay(node).md,
      langLabel: langLabel(),
      wantVideo: true,
      videoOnly: true,
      ...(quotedText === undefined ? {} : { quotedText }),
      signal: llm.begin(),
    });
    const video = firstVideo(parseSources(raw, newId, searched));
    if (!video) {
      // Its own outcome, not an error. The model was asked to return nothing
      // rather than pad the list with a clip that merely shares the topic
      // name, so "there isn't a good one" is the honest answer working.
      useSourceStore.getState().note(node.id, getStrings().videoNone);
      return null;
    }
    return video;
  } catch (err) {
    if (!isAbort(err)) useSourceStore.getState().note(node.id, getStrings().videoNone);
    return null;
  } finally {
    useLlmStore.getState().end();
    useSourceStore.getState().end();
  }
}

/**
 * Find a video for a whole node and put it on the canvas.
 *
 * Hangs off the node with a `reply` edge: nothing was asked, the graph is
 * answering the passage with something to watch.
 */
export async function findVideoFor(nodeId: string): Promise<string | null> {
  const node = useGraphStore.getState().nodes[nodeId];
  if (!node) return null;
  const video = await requestVideo(node);
  if (!video) return null;
  return useGraphStore.getState().addVideo(nodeId, video, captionFor(video));
}

/**
 * Find a video for the highlighted phrase and branch it off that phrase.
 *
 * The same gesture as なんで？, so it anchors the same way — a highlight in the
 * parent, a `why` edge, the pink underline that leads back and forth. Asking to
 * be shown a sentence is asking about that sentence.
 */
export async function findVideoForHighlight(
  nodeId: string,
  sel: { start: number; end: number; text: string; lang?: string },
): Promise<string | null> {
  const node = useGraphStore.getState().nodes[nodeId];
  if (!node) return null;
  const video = await requestVideo(node, sel.text);
  if (!video) return null;
  return useGraphStore.getState().addVideoBranch(nodeId, sel, video, captionFor(video));
}
