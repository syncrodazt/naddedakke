import {
  EDGE_KINDS,
  NODE_KINDS,
  type REdge,
  type RNode,
  type Session,
  type SessionExport,
} from '../model/types';

export function exportSession(
  session: Session,
  nodes: Record<string, RNode>,
  edges: Record<string, REdge>,
): SessionExport {
  return {
    schemaVersion: 1,
    session,
    nodes: Object.values(nodes).sort((a, b) => a.seq - b.seq),
    edges: Object.values(edges),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function fail(message: string): never {
  throw new Error(`invalid session file: ${message}`);
}

function validateSession(v: unknown): Session {
  if (!isRecord(v)) fail('session is not an object');
  const { id, title, mode, createdAt, seqCounter } = v;
  if (typeof id !== 'string' || id === '') fail('session.id');
  if (typeof title !== 'string') fail('session.title');
  if (mode !== 'learn' && mode !== 'gyakusan') fail('session.mode');
  if (typeof createdAt !== 'number') fail('session.createdAt');
  if (typeof seqCounter !== 'number' || seqCounter < 0) fail('session.seqCounter');
  return { id, title, mode, createdAt, seqCounter };
}

function validateHighlight(v: unknown, where: string): RNode['content']['highlights'][number] {
  if (!isRecord(v)) fail(`${where} highlight is not an object`);
  const { id, start, end, text, childNodeId } = v;
  if (typeof id !== 'string') fail(`${where} highlight.id`);
  if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end < start) {
    fail(`${where} highlight offsets`);
  }
  if (typeof text !== 'string') fail(`${where} highlight.text`);
  if (childNodeId !== undefined && typeof childNodeId !== 'string') {
    fail(`${where} highlight.childNodeId`);
  }
  return { id, start, end, text, ...(childNodeId !== undefined ? { childNodeId } : {}) };
}

function validateNode(v: unknown, sessionId: string): RNode {
  if (!isRecord(v)) fail('node is not an object');
  const { id, kind, seq, position, content } = v;
  if (typeof id !== 'string' || id === '') fail('node.id');
  if (typeof kind !== 'string' || !NODE_KINDS.includes(kind as RNode['kind'])) {
    fail(`node.kind "${String(kind)}"`);
  }
  if (v.sessionId !== sessionId) fail(`node ${id} sessionId mismatch`);
  if (typeof seq !== 'number' || seq < 0) fail(`node ${id} seq`);
  if (!isRecord(position) || typeof position.x !== 'number' || typeof position.y !== 'number') {
    fail(`node ${id} position`);
  }
  if (!isRecord(content) || typeof content.md !== 'string' || !Array.isArray(content.highlights)) {
    fail(`node ${id} content`);
  }
  const node: RNode = {
    id,
    sessionId,
    kind: kind as RNode['kind'],
    seq,
    position: { x: position.x, y: position.y },
    content: {
      md: content.md,
      highlights: content.highlights.map((h) => validateHighlight(h, `node ${id}`)),
    },
  };
  if (v.formula !== undefined) {
    if (typeof v.formula !== 'string') fail(`node ${id} formula`);
    node.formula = v.formula;
  }
  if (v.value !== undefined) {
    if (typeof v.value !== 'number') fail(`node ${id} value`);
    node.value = v.value;
  }
  if (v.unit !== undefined) {
    if (typeof v.unit !== 'string') fail(`node ${id} unit`);
    node.unit = v.unit;
  }
  if (v.varInput !== undefined) {
    const vi = v.varInput;
    if (
      !isRecord(vi) ||
      typeof vi.min !== 'number' ||
      typeof vi.max !== 'number' ||
      typeof vi.step !== 'number'
    ) {
      fail(`node ${id} varInput`);
    }
    node.varInput = { min: vi.min, max: vi.max, step: vi.step };
  }
  if (v.playground !== undefined) {
    const pg = v.playground;
    if (!isRecord(pg) || typeof pg.key !== 'string' || !isRecord(pg.params)) {
      fail(`node ${id} playground`);
    }
    for (const [k, val] of Object.entries(pg.params)) {
      if (typeof val !== 'number') fail(`node ${id} playground.params.${k}`);
    }
    node.playground = { key: pg.key, params: pg.params as Record<string, number> };
  }
  return node;
}

function validateEdge(v: unknown, sessionId: string, nodeIds: Set<string>): REdge {
  if (!isRecord(v)) fail('edge is not an object');
  const { id, kind, source, target } = v;
  if (typeof id !== 'string' || id === '') fail('edge.id');
  if (typeof kind !== 'string' || !EDGE_KINDS.includes(kind as REdge['kind'])) {
    fail(`edge.kind "${String(kind)}"`);
  }
  if (v.sessionId !== sessionId) fail(`edge ${id} sessionId mismatch`);
  if (typeof source !== 'string' || !nodeIds.has(source)) fail(`edge ${id} source`);
  if (typeof target !== 'string' || !nodeIds.has(target)) fail(`edge ${id} target`);
  return { id, sessionId, kind: kind as REdge['kind'], source, target };
}

export function validateImport(json: unknown): SessionExport {
  if (!isRecord(json)) fail('not an object');
  if (json.schemaVersion !== 1) fail(`unsupported schemaVersion ${String(json.schemaVersion)}`);
  const session = validateSession(json.session);
  if (!Array.isArray(json.nodes)) fail('nodes is not an array');
  if (!Array.isArray(json.edges)) fail('edges is not an array');
  const nodes = json.nodes.map((n) => validateNode(n, session.id));
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (nodeIds.size !== nodes.length) fail('duplicate node ids');
  const edges = json.edges.map((e) => validateEdge(e, session.id, nodeIds));
  return { schemaVersion: 1, session, nodes, edges };
}
