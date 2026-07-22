export type Session = {
  id: string;
  title: string;
  mode: 'learn' | 'gyakusan';
  createdAt: number;
  seqCounter: number;
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
    md: string; // markdown body
    highlights: Highlight[];
  };
  // gyakusan only:
  formula?: string; // mathjs expr referencing other node ids by name
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
