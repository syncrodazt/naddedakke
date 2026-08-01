// "What should I learn next?"
//
// A concept map is NOT the reasoning graph. The reasoning graph is the record
// of what was actually asked, in the order it was asked, and nothing synthetic
// is ever allowed into it — `seq` would stop meaning anything. This is a
// separate, disposable, regenerable thing: a proposal about a subject, laid
// over what the learner already has.
//
// It is also not an association graph. Every edge here is a PREREQUISITE and
// points one way, because the only question it exists to answer is "what can I
// start next", and an undirected "these are related" edge cannot answer it.

/** How much of a concept the learner already has. Derived, never stored. */
export type ConceptStatus =
  | 'known' // a notebook covers it and they marked it understood
  | 'met' // a notebook covers it, but it is not understood yet
  | 'unknown'; // nothing in the library covers it

export type Concept = {
  /** Stable slug, so a regenerated map keeps its links to notebooks. */
  id: string;
  name: string;
  /** One sentence, in the learner's language: what this concept is. */
  blurb: string;
  /**
   * The subject this belongs to — "Web security", "Wave physics".
   *
   * Purely for reading the map. A flat graph of thirty concepts from six
   * unrelated fields is a wall of cards with no way in; grouped into subjects,
   * most prerequisite edges stay inside one band and the ones that cross are
   * the interesting ones.
   */
  area: string;
  /** Concept ids this builds on. The only edge type in stage 1. */
  prereqs: string[];
  /**
   * Notebooks that cover it. The model proposes these from the inventory it is
   * given; they are checked against real ids before anything is stored.
   */
  sessionIds: string[];
  /**
   * Why this is being suggested — one sentence naming what it connects to. A
   * recommendation with no stated reason is one you can only obey, not judge,
   * which is the wrong relationship to have with generated curriculum.
   */
  why?: string;
};

export type ConceptMap = {
  /** Fixed id: there is one map, regenerated in place. */
  id: 'current';
  generatedAt: number;
  /** Notebook titles the map was built from, for "is this stale?". */
  builtFrom: string[];
  concepts: Concept[];
};

/** A concept plus everything computed about it. Never persisted. */
export type RankedConcept = {
  concept: Concept;
  status: ConceptStatus;
  /** Every prerequisite is known — you could start this today. */
  ready: boolean;
  /** Prerequisites not yet known, by name, for saying WHY it is not ready. */
  missing: string[];
  /** How many not-yet-known concepts this one stands upstream of. */
  unlocks: number;
  /** How many of its prerequisites you already have — how grounded it is. */
  grounding: number;
};
