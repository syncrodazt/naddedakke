export type Session = {
  id: string;
  title: string;
  mode: 'learn' | 'gyakusan';
  createdAt: number; // when the first question was asked
  /**
   * When the graph last changed. Undefined on notebooks written before this
   * existed — the library falls back to `createdAt` for those rather than
   * inventing a time it cannot know.
   */
  updatedAt?: number;
  seqCounter: number;
  /**
   * Which language the learner wants to READ this notebook in. Undefined means
   * "as written". Switching it never rewrites anything — every node keeps its
   * original body and gains translations alongside it (see RNode.content).
   */
  contentLang?: string;
};

export type NodeKind =
  | 'chunk' // Claude's lesson step (spine)
  | 'question' // user's なんで？ (branch) — stores the highlighted text
  | 'answer' // Claude's reply to a question
  | 'playground' // interactive figure (self-contained JS component key + params)
  | 'goal'
  | 'variable'
  | 'derived' // gyakusan
  | 'video'; // reserved, unimplemented

export type RNode = {
  id: string;
  sessionId: string;
  kind: NodeKind;
  seq: number; // global monotonic order — the replay timeline
  position: { x: number; y: number };
  size?: { width: number; height: number }; // user-resized dimensions (optional)
  branchIntent?: 'why' | 'respond' | 'idea'; // question node: なんで？ / learner's answer / free-form idea
  understood?: boolean; // learner marked this node understood (closes the loop)
  content: {
    md: string; // markdown body, as originally written
    highlights: Highlight[];
    /** Language `md` is written in, once known. Undefined = never determined. */
    lang?: string;
    /**
     * The same body in other languages, keyed by language code. Additive only:
     * `md` is the record of what was actually said and is never overwritten, so
     * switching back to the original is free and nothing is ever lost.
     */
    translations?: Record<string, string>;
  };
  // gyakusan only:
  formula?: string; // mathjs expr referencing other nodes by their varName
  // The identifier this node is known by inside formulas. Defaults to `id` for
  // hand-authored fixtures whose ids are already readable identifiers. Generated
  // graphs need the two separated: `id` is the Dexie primary key and must be
  // globally unique, while the formula name is short, readable and only unique
  // within its own session — two back-cast plans may both want `current_age`.
  varName?: string;
  value?: number;
  unit?: string;
  // playground only: registered component key + serializable params
  playground?: PlaygroundRef;
  // variable only: slider/number-input config
  varInput?: { min: number; max: number; step: number };
};

export type PlaygroundRef = {
  key: string; // registry key of a first-party React component
  params: Record<string, number>;
};

export type Highlight = {
  id: string;
  start: number; // char offsets into md source
  end: number;
  text: string; // denormalized quote (offset drift guard)
  /**
   * Which body `start`/`end`/`text` index: a key of `content.translations`, or
   * undefined for the original `content.md`. A highlight made while reading a
   * translation is anchored in that translation, not back-projected onto the
   * original — there is no honest way to map offsets across a translation.
   */
  lang?: string;
  /**
   * The same passage quoted in other languages, keyed by language code. This is
   * what re-anchors the highlight when a translated body is displayed: the
   * quote is searched for, exactly as `text` guards against offset drift.
   */
  quotes?: Record<string, string>;
  childNodeId?: string; // the question node it spawned
};

export type EdgeKind =
  | 'next' // chronological spine chunk→chunk
  | 'why' // parent node → question node (labeled with the highlighted phrase)
  | 'reply' // question → answer
  | 'depends'; // gyakusan dataflow (source feeds target's formula)

export type REdge = {
  id: string;
  sessionId: string;
  kind: EdgeKind;
  source: string;
  target: string;
};

export type SessionExport = {
  schemaVersion: 1;
  session: Session;
  nodes: RNode[];
  edges: REdge[];
};

export const NODE_KINDS: readonly NodeKind[] = [
  'chunk',
  'question',
  'answer',
  'playground',
  'goal',
  'variable',
  'derived',
  'video',
];

export const EDGE_KINDS: readonly EdgeKind[] = ['next', 'why', 'reply', 'depends'];
