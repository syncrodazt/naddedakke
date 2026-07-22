import Dexie, { type Table } from 'dexie';
import type { REdge, RNode, Session } from '../model/types';

export class NandeDB extends Dexie {
  sessions!: Table<Session, string>;
  nodes!: Table<RNode, string>;
  edges!: Table<REdge, string>;

  constructor() {
    super('nandedakke');
    this.version(1).stores({
      sessions: 'id, createdAt',
      nodes: 'id, sessionId, [sessionId+seq]',
      edges: 'id, sessionId',
    });
  }
}

export const db = new NandeDB();
