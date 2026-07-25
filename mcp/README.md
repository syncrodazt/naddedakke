# nandedakke MCP server

Exposes your なんでだっけ？ learning graphs to Claude Desktop / Claude Code, so you
can ask Claude about a session it can actually read — including the chain of
なんで？ questions in the order you asked them, and which threads you left open.

**Read-only by design.** The canvas is your record of how your understanding was
built; an assistant editing it would corrupt the one thing the app exists to
preserve. Every tool answers questions about the graph. None writes to it.

## Build

```bash
npm run build:mcp     # → mcp/dist/mcp/index.js
```

## Where it reads sessions from

The app is local-first: graphs live in the browser's IndexedDB, which no outside
process can read. So there are two ways in, and you can use either or both.

### 1. Exported files (no setup)

Use the app's **Export** button and save the `.json` into one directory.

| Env var          | Default                 |
| ---------------- | ----------------------- |
| `NANDEDAKKE_DIR` | `~/nandedakke-sessions` |

### 2. Supabase (the same rows the app syncs)

Set all four, or none. The server signs in as **you**, so Row Level Security
applies exactly as it does in the browser — it can only ever see your own rows.

| Env var               | Value                                       |
| --------------------- | ------------------------------------------- |
| `SUPABASE_URL`        | `https://<ref>.supabase.co` — bare, no path |
| `SUPABASE_ANON_KEY`   | the **publishable** key (public by design)  |
| `NANDEDAKKE_EMAIL`    | the email you log into the app with         |
| `NANDEDAKKE_PASSWORD` | that account's password                     |

Never put the Supabase **secret** key here — it bypasses RLS.

When a session id appears in both sources, the cloud copy wins: it is newer than
whatever file was exported from it at some past moment.

## Register it

Claude Desktop — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nandedakke": {
      "command": "node",
      "args": ["/absolute/path/to/naddedakke/mcp/dist/mcp/index.js"],
      "env": { "NANDEDAKKE_DIR": "/absolute/path/to/your/sessions" }
    }
  }
}
```

Claude Code:

```bash
claude mcp add nandedakke -e NANDEDAKKE_DIR=/path/to/sessions \
  -- node /absolute/path/to/naddedakke/mcp/dist/mcp/index.js
```

## Tools

| Tool                  | What it answers                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_sessions`       | What sessions exist — id, title, mode, node count, source. Start here.                                                                                |
| `get_session_outline` | One line per node in `seq` order. Cheap overview before pulling bodies.                                                                               |
| `get_reasoning_chain` | The session as you built it: chunks, your なんで？ branches with the exact passage each was asked about, and the answers. Optional `fromSeq`/`toSeq`. |
| `get_node`            | One node in full, plus the questions its own highlights spawned. Includes gyakusan `formula`/`value`.                                                 |
| `list_open_questions` | Questions with no answer, and answers never marked understood. Lesson chunks never count.                                                             |
| `search_nodes`        | Case-insensitive substring search across every session, with excerpts.                                                                                |

`seq` is the app's chronological timeline and is never renumbered, so every
ordering here is the order you actually learned things in — not layout order.

## Troubleshooting

Diagnostics go to **stderr** (stdout is the MCP protocol channel). On startup the
server prints the directory it is reading and whether the cloud source is on.

If the cloud source fails, tools still return your local files and add a
`cloudError` field explaining why — they do not silently pretend the cloud
sessions never existed.
