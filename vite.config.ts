/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { DEFAULT_GEMINI_MODEL, isChatPayload, proxyChat } from './server/gemini.ts';

// Dev-mode /api/chat handler — mirrors api/chat.ts (the Vercel edge function)
// so the browser code is identical in dev and production. The GEMINI_API_KEY
// lives in .env.local and never reaches the client bundle.
function chatProxy(env: Record<string, string>): Plugin {
  return {
    name: 'nandedakke-chat-proxy',
    configureServer(server) {
      server.middlewares.use('/api/chat', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('method not allowed');
          return;
        }
        let raw = '';
        req.on('data', (c: Buffer) => (raw += c.toString()));
        req.on('end', () => {
          void (async () => {
            const apiKey = env.GEMINI_API_KEY;
            if (!apiKey) {
              res.statusCode = 503;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'GEMINI_API_KEY is not configured (.env.local)' }));
              return;
            }
            let payload: unknown = null;
            try {
              payload = JSON.parse(raw);
            } catch {
              /* handled below */
            }
            if (!isChatPayload(payload)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'invalid payload' }));
              return;
            }
            const upstream = await proxyChat(
              payload,
              apiKey,
              env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
            );
            res.statusCode = upstream.status;
            res.setHeader(
              'Content-Type',
              upstream.headers.get('content-type') ?? 'text/event-stream',
            );
            res.setHeader('Cache-Control', 'no-store');
            if (!upstream.body) {
              res.end();
              return;
            }
            for await (const chunk of upstream.body) {
              res.write(chunk);
            }
            res.end();
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
