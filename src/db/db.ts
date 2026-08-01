import Dexie, { type Table } from 'dexie';
import type { REdge, RNode, Session } from '../model/types';
import type { ConceptMap } from '../concepts/types';

export class NandeDB extends Dexie {
  sessions!: Table<Session, string>;
  nodes!: Table<RNode, string>;
  edges!: Table<REdge, string>;
  /**
   * The "what to learn next" map. One row, id 'current' — it is a regenerable
   * proposal about a subject, not a record of anything the learner did, so
   * there is no history to keep.
   */
  concepts!: Table<ConceptMap, string>;

  constructor() {
    super('nandedakke');
    this.version(1).stores({
      sessions: 'id, createdAt',
      nodes: 'id, sessionId, [sessionId+seq]',
      edges: 'id, sessionId',
    });
    // v2 indexes updatedAt so the library can list notebooks most-recently-
    // touched first without reading every row. Existing rows keep their data;
    // their updatedAt is simply absent until the next edit.
    this.version(2).stores({
      sessions: 'id, createdAt, updatedAt',
      nodes: 'id, sessionId, [sessionId+seq]',
      edges: 'id, sessionId',
    });
    this.version(3).stores({
      sessions: 'id, createdAt, updatedAt',
      nodes: 'id, sessionId, [sessionId+seq]',
      edges: 'id, sessionId',
      concepts: 'id',
    });
  }
}

export const db = new NandeDB();
