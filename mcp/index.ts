#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { configFromEnv, loadAll, type LoadedSession, type SourceConfig } from './sources.js';
import { nodeDetail, openQuestions, outline, reasoningChain, searchNodes } from './graph.js';

// MCP server exposing a learner's なんでだっけ？ graphs to Claude Desktop / Claude
// Code. It is READ-ONLY by design: the canvas is the learner's own record of how
// their understanding was built, and an assistant silently rewriting it would
// corrupt exactly the thing the app exists to preserve. Everything here answers
// questions about the graph; nothing edits it.
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

const server = new McpServer({ name: 'nandedakke', version: '1.0.0' });

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
