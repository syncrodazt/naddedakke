import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  ConflictError,
  configFromEnv,
  loadAll,
  saveSession,
  type LoadedSession,
  type SourceConfig,
} from './sources';
import { nodeDetail, openQuestions, outline, reasoningChain, searchNodes } from './graph';
import {
  WriteError,
  addAnswer,
  addChunk,
  addQuestion,
  createSession,
  describeWrite,
  markUnderstood,
  setVariable,
} from './mutate';
import type { SessionExport } from '../src/model/types';

// MCP server exposing a learner's なんでだっけ？ graphs to Claude Desktop / Claude
// Code: read the graph, and append to it.
//
// The writes are strictly additive. Nothing here edits or deletes existing node
// markdown, because the canvas is the learner's record of how their
// understanding was actually built — adding to that record is useful, silently
// rewriting it is corruption. Invariants (seq never rewinds, every branch
// anchors to a real highlighted passage) are enforced in mutate.ts.
//
// Setup lives in mcp/README.md.

const config: SourceConfig = configFromEnv(process.env);

async function library(): Promise<{ sessions: LoadedSession[]; cloudError?: string }> {
  return loadAll(config);
}

function json(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function problem(message: string): {
  content: { type: 'text'; text: string }[];
  isError: true;
} {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function findSession(sessionId: string) {
  const { sessions, cloudError } = await library();
  const found = sessions.find((s) => s.export.session.id === sessionId);
  if (found) return { found };
  const known = sessions.map((s) => s.export.session.id);
  return {
    error:
      `No session with id "${sessionId}".` +
      (known.length > 0 ? ` Known ids: ${known.join(', ')}.` : ' The library is empty.') +
      (cloudError ? ` (cloud source unavailable: ${cloudError})` : ''),
  };
}

/**
 * Read a session, transform it, write it back where it came from. The read is
 * deliberately fresh on every call rather than cached: the learner may have the
 * app open, and writing from a stale copy is how their edits get lost.
 */
async function mutate(
  sessionId: string,
  apply: (exp: SessionExport) => { next: SessionExport; result?: Record<string, unknown> },
) {
  const { found, error } = await findSession(sessionId);
  if (!found) return problem(error);
  try {
    const { next, result } = apply(found.export);
    const saved = await saveSession(config, next, found);
    return json({ ...describeWrite(next), ...result, savedTo: saved.source });
  } catch (err) {
    if (err instanceof WriteError || err instanceof ConflictError) return problem(err.message);
    throw err;
  }
}

const server = new McpServer({ name: 'nandedakke', version: '2.0.0' });

server.registerTool(
  'list_sessions',
  {
    title: 'List learning sessions',
    description:
      'Every なんでだっけ？ session available, newest first: id, title, mode ' +
      '(learn or gyakusan/back-cast), node count and where it was read from. ' +
      'Start here — the other tools take a sessionId.',
    inputSchema: {},
  },
  async () => {
    const { sessions, cloudError } = await library();
    return json({
      sessions: sessions.map((s) => ({
        id: s.export.session.id,
        title: s.export.session.title,
        mode: s.export.session.mode,
        createdAt: new Date(s.export.session.createdAt).toISOString(),
        nodeCount: s.export.nodes.length,
        source: s.source,
      })),
      ...(cloudError ? { cloudError } : {}),
      ...(sessions.length === 0
        ? { hint: `No sessions found. Export some from the app into ${config.dir}.` }
        : {}),
    });
  },
);

server.registerTool(
  'get_session_outline',
  {
    title: 'Outline a session',
    description:
      'One line per node in chronological (seq) order — kind, title, whether the ' +
      'learner marked it understood. Cheap overview; use get_reasoning_chain for bodies.',
    inputSchema: { sessionId: z.string().describe('id from list_sessions') },
  },
  async ({ sessionId }) => {
    const { found, error } = await findSession(sessionId);
    if (!found) return problem(error);
    return json({ title: found.export.session.title, nodes: outline(found.export) });
  },
);

server.registerTool(
  'get_reasoning_chain',
  {
    title: 'Read the reasoning chain',
    description:
      'The session in the order the learner actually built it: lesson chunks, ' +
      'the なんで？(why) questions they branched off specific highlighted passages, ' +
      'and the answers. Each branch carries the exact passage it was asked about. ' +
      'This is the full record of how their understanding got where it is — read ' +
      'it before explaining anything, so you can pick up from what they already know.',
    inputSchema: {
      sessionId: z.string().describe('id from list_sessions'),
      fromSeq: z.number().optional().describe('start at this seq (default: the beginning)'),
      toSeq: z.number().optional().describe('stop at this seq (default: the end)'),
    },
  },
  async ({ sessionId, fromSeq, toSeq }) => {
    const { found, error } = await findSession(sessionId);
    if (!found) return problem(error);
    const chain = reasoningChain(found.export).filter(
      (e) => e.seq >= (fromSeq ?? -Infinity) && e.seq <= (toSeq ?? Infinity),
    );
    return json({ title: found.export.session.title, chain });
  },
);

server.registerTool(
  'get_node',
  {
    title: 'Read one node',
    description:
      'One node in full: its markdown, what it branched off, the passage it was ' +
      'asked about, and the questions its own highlights spawned. Includes the ' +
      'mathjs formula and value for back-cast (gyakusan) nodes.',
    inputSchema: {
      sessionId: z.string().describe('id from list_sessions'),
      nodeId: z.string().describe('id from an outline, chain or search result'),
    },
  },
  async ({ sessionId, nodeId }) => {
    const { found, error } = await findSession(sessionId);
    if (!found) return problem(error);
    const detail = nodeDetail(found.export, nodeId);
    return detail ? json(detail) : problem(`No node "${nodeId}" in session "${sessionId}".`);
  },
);

server.registerTool(
  'list_open_questions',
  {
    title: 'List unresolved questions',
    description:
      'What the learner left hanging: questions with no answer, and answers they ' +
      'never marked understood. Lesson chunks are excluded — only their own ' +
      'branches count as loose ends. Use this to find what to revisit.',
    inputSchema: {
      sessionId: z.string().optional().describe('omit to scan every session'),
    },
  },
  async ({ sessionId }) => {
    const { sessions, cloudError } = await library();
    const scope = sessionId ? sessions.filter((s) => s.export.session.id === sessionId) : sessions;
    if (sessionId && scope.length === 0) {
      return problem((await findSession(sessionId)).error ?? 'not found');
    }
    return json({
      sessions: scope.map((s) => ({
        sessionId: s.export.session.id,
        title: s.export.session.title,
        open: openQuestions(s.export),
      })),
      ...(cloudError ? { cloudError } : {}),
    });
  },
);

server.registerTool(
  'search_nodes',
  {
    title: 'Search node text',
    description:
      'Case-insensitive substring search across every session, returning matching ' +
      'nodes with an excerpt. Use it to find where a concept was already covered.',
    inputSchema: {
      query: z.string().describe('text to look for'),
      limit: z.number().optional().describe('max hits (default 30)'),
    },
  },
  async ({ query, limit }) => {
    const { sessions, cloudError } = await library();
    const hits = searchNodes(
      sessions.map((s) => s.export),
      query,
      limit ?? 30,
    );
    return json({ query, hits, ...(cloudError ? { cloudError } : {}) });
  },
);

// ---- Writes ------------------------------------------------------------------
// All additive. `openWorldHint: false` because everything acts on the learner's
// own session store, and `idempotentHint: false` because calling add_chunk twice
// really does create two chunks — the client should not silently retry.

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;

server.registerTool(
  'create_session',
  {
    title: 'Create a session',
    description:
      'Start a new empty notebook. Use mode "learn" for a lesson graph, ' +
      '"gyakusan" for a back-cast goal graph. Add content with add_chunk.',
    inputSchema: {
      title: z.string().describe("the notebook's title, in the learner's language"),
      mode: z.enum(['learn', 'gyakusan']).optional().describe('default: learn'),
    },
    annotations: WRITE,
  },
  async ({ title, mode }) => {
    if (title.trim() === '') return problem('title is empty');
    const exp = createSession(title.trim(), mode ?? 'learn', Date.now());
    try {
      const saved = await saveSession(config, exp);
      return json({
        ...describeWrite(exp),
        savedTo: saved.source,
        ...(saved.path ? { path: saved.path } : {}),
      });
    } catch (err) {
      if (err instanceof ConflictError) return problem(err.message);
      throw err;
    }
  },
);

server.registerTool(
  'add_chunk',
  {
    title: 'Append a lesson step',
    description:
      'Add a lesson step to the end of the spine. Markdown; KaTeX ($…$) is ' +
      "rendered, raw HTML is not. Write in the learner's language. Keep it to one " +
      'small step — the whole pedagogy is chunk-by-chunk, not a dumped lesson.',
    inputSchema: {
      sessionId: z.string().describe('id from list_sessions'),
      md: z.string().describe('the chunk body, starting with "## <title>"'),
    },
    annotations: WRITE,
  },
  ({ sessionId, md }) =>
    mutate(sessionId, (exp) => {
      const { next, nodeId } = addChunk(exp, md);
      return { next, result: describeWrite(next, nodeId) };
    }),
);

server.registerTool(
  'add_question',
  {
    title: 'Branch a question off a passage',
    description:
      'Add a なんで？ question hanging off an exact passage of another node. ' +
      "`quotedText` MUST be copied verbatim from that node's markdown (get_node " +
      'returns it) — it becomes the pink underline in the parent and the link back ' +
      'from the question, and a branch with no anchor is a bug. Answer it with ' +
      'add_answer.',
    inputSchema: {
      sessionId: z.string().describe('id from list_sessions'),
      parentNodeId: z.string().describe('the node the question is about'),
      quotedText: z.string().describe("verbatim passage from the parent's markdown"),
      question: z.string().describe("the question itself, in the learner's language"),
    },
    annotations: WRITE,
  },
  ({ sessionId, parentNodeId, quotedText, question }) =>
    mutate(sessionId, (exp) => {
      const { next, nodeId } = addQuestion(exp, parentNodeId, quotedText, question);
      return { next, result: describeWrite(next, nodeId) };
    }),
);

server.registerTool(
  'add_answer',
  {
    title: 'Answer a question',
    description:
      'Attach an answer to a question node that has none. Explain from first ' +
      'principles: conclusion first, derivation after. Read get_reasoning_chain ' +
      'first so the answer builds on what the learner already covered.',
    inputSchema: {
      sessionId: z.string().describe('id from list_sessions'),
      questionId: z.string().describe('a question node id, e.g. from list_open_questions'),
      md: z.string().describe('the answer body in Markdown'),
    },
    annotations: WRITE,
  },
  ({ sessionId, questionId, md }) =>
    mutate(sessionId, (exp) => {
      const { next, nodeId } = addAnswer(exp, questionId, md);
      return { next, result: describeWrite(next, nodeId) };
    }),
);

server.registerTool(
  'mark_understood',
  {
    title: 'Mark a node understood',
    description:
      "Set or clear the learner's “I get this now” flag on a node. This is their " +
      'own judgement — only set it when they have said so, not because an ' +
      'explanation was given.',
    inputSchema: {
      sessionId: z.string().describe('id from list_sessions'),
      nodeId: z.string().describe('the node to flag'),
      understood: z.boolean().describe('true to mark understood, false to clear'),
    },
    annotations: WRITE,
  },
  ({ sessionId, nodeId, understood }) =>
    mutate(sessionId, (exp) => ({ next: markUnderstood(exp, nodeId, understood) })),
);

server.registerTool(
  'set_variable',
  {
    title: 'Move a back-cast variable',
    description:
      'Set a gyakusan variable node’s value and recompute every downstream ' +
      'derived quantity with the same engine the canvas uses. Only input ' +
      'variables can be set — a derived node follows from its formula.',
    inputSchema: {
      sessionId: z.string().describe('id from list_sessions'),
      nodeId: z.string().describe('a variable node id'),
      value: z.number().describe('the new value'),
    },
    annotations: WRITE,
  },
  ({ sessionId, nodeId, value }) =>
    mutate(sessionId, (exp) => {
      const { next, issues } = setVariable(exp, nodeId, value);
      const changed = next.nodes
        .filter((n) => n.value !== undefined)
        .map((n) => ({ id: n.id, varName: n.varName, value: n.value, unit: n.unit }));
      return {
        next,
        result: { values: changed, ...(Object.keys(issues).length > 0 ? { issues } : {}) },
      };
    }),
);

async function main(): Promise<void> {
  // stdout is the MCP channel — anything written there that is not a protocol
  // message corrupts the session, so diagnostics go to stderr.
  process.stderr.write(`[nandedakke-mcp] reading sessions from ${config.dir}\n`);
  if (config.supabase) process.stderr.write(`[nandedakke-mcp] cloud source enabled\n`);
  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  process.stderr.write(`[nandedakke-mcp] fatal: ${String(err)}\n`);
  process.exit(1);
});
