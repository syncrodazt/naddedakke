/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import {
  DEFAULT_GEMINI_MODEL,
  isChatPayload,
  listModels,
  proxyChat,
  type ModelOption,
} from './server/gemini.ts';
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  isClaudePayload,
  proxyClaude,
} from './server/claude.ts';
import type { ServerResponse } from 'node:http';

/** Read a JSON request body, then hand it to the handler. */
function readJson(
  req: { on: (ev: string, fn: (c: Buffer) => void) => void },
  done: (payload: unknown) => void,
): void {
  let raw = '';
  req.on('data', (c: Buffer) => {
    raw += c.toString();
  });
  req.on('end', () => {
    try {
      done(JSON.parse(raw));
    } catch {
      done(null);
    }
  });
}

/** Pipe a fetch Response into a Node response, preserving status and headers. */
async function pipe(upstream: Response, res: ServerResponse): Promise<void> {
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  if (!upstream.body) {
    res.end();
    return;
  }
  for await (const chunk of upstream.body) {
    res.write(chunk);
  }
  res.end();
}

// Dev-mode /api/* handlers — mirror the Vercel edge functions (api/chat.ts,
// api/claude.ts, api/models.ts) so the browser code is identical in dev and
// production. GEMINI_API_KEY / ANTHROPIC_API_KEY live in .env.local and never
// reach the client bundle.
function chatProxy(env: Record<string, string>): Plugin {
  return {
    name: 'nandedakke-chat-proxy',
    configureServer(server) {
      server.middlewares.use('/api/models', (_req, res) => {
        void (async () => {
          res.setHeader('Content-Type', 'application/json');
          const models: ModelOption[] = [];
          // Claude first: it is the better provider, so it leads the picker.
          if (env.ANTHROPIC_API_KEY) models.push(...CLAUDE_MODELS);
          if (env.GEMINI_API_KEY) models.push(...(await listModels(env.GEMINI_API_KEY)));
          res.end(JSON.stringify({ models }));
        })().catch(() => {
          res.statusCode = 200;
          res.end(JSON.stringify({ models: [] }));
        });
      });
      server.middlewares.use('/api/claude', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('method not allowed');
          return;
        }
        readJson(req, (payload) => {
          void (async () => {
            const apiKey = env.ANTHROPIC_API_KEY;
            if (!apiKey) {
              res.statusCode = 503;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured (.env.local)' }),
              );
              return;
            }
            if (!isClaudePayload(payload)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'invalid payload' }));
              return;
            }
            await pipe(
              await proxyClaude(payload, apiKey, env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL),
              res,
            );
          })().catch((err: unknown) => {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: String(err) }));
          });
        });
      });
      server.middlewares.use('/api/chat', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('method not allowed');
          return;
        }
        readJson(req, (payload) => {
          void (async () => {
            const apiKey = env.GEMINI_API_KEY;
            if (!apiKey) {
              res.statusCode = 503;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'GEMINI_API_KEY is not configured (.env.local)' }));
              return;
            }
            if (!isChatPayload(payload)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'invalid payload' }));
              return;
            }
            await pipe(
              await proxyChat(payload, apiKey, env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL),
              res,
            );
          })().catch((err: unknown) => {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: String(err) }));
          });
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), chatProxy(env)],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      passWithNoTests: true,
    },
  };
});
