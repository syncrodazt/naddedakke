# CLAUDE.md — nandedakke.com（なんでだっけ？）

## What this project is

An infinite-canvas reasoning graph — think Miro / Unreal Engine Blueprints, but the
graph *is* a chronological record of a learning conversation with Claude.

The owner's core goal: **first-principles understanding**. The graph is not a
mind-map of associations (explicitly NOT the Obsidian graph view). It is a
**sequential, chronological chain of reasoning**: lesson chunks flow left→right,
and every "why?" the user asks branches off the exact sentence that provoked it.

Two modes share one canvas engine:

1. **Learn mode (MVP).** Claude teaches a topic in ~10 chunks. Each chunk is a
   node. The user highlights any sentence/term inside a node and hits a built-in
   **なんで？(why?) button** → a question node branches off that highlight → Claude
   answers → the user can recurse ("why?" on the answer) until the concept is
   understood from first principles. Everything keeps strict chronological order,
   with a **replay button** that re-plays the whole session from the first
   question, camera following each node as it appears.
2. **逆算 (Gyakusan / back-cast) mode (Phase 2).** Start from a goal node
   (e.g., "FIRE by 35") and decompose backwards into dependency nodes with
   editable variables. Changing a variable (target age, savings rate, expected
   return) reactively recomputes every downstream node (e.g., required monthly
   savings) — a dataflow/spreadsheet graph, like Blueprint pins.

Answers can be plain text, or **interactive tutorial nodes** (inline SVG figures,
canvas playgrounds with sliders). Video nodes come later — design the node type
enum to allow it, don't build it.

## Design lineage (important context)

The owner has an existing static-HTML pattern from tutoring sessions
("graph-explainer"): a linear spine of lesson cards, user questions as branch
cards anchored to `<mark>`-highlighted sentences, hand-built inline SVG figures,
and canvas playgrounds with sliders. This app is the interactive, infinite-canvas
evolution of that. Carry over:

- **Spine = lesson steps. Branches = the user's questions.** Never mix them.
- Every branch **must** anchor to a highlighted text range in its parent node.
  A branch with no anchor is a bug.
- Interaction feel: Bartosz Ciechanowski / Josh W. Comeau — direct manipulation,
  smooth camera moves, figures you can touch. Not dashboard-y.
- Fixed palette (keep consistent forever so old sessions still match):
  `--bg:#EEF1F4 --card:#FFF --ink:#12202E --muted:#5B6B7B --grid:#D5DDE4
   --branch:#C2185B --alias:#0B8F8C --guard:#E8B923`
  Semantics: `--branch` (pink) = user's question / the thing that goes wrong;
  `--alias` (teal) = the observed/safe case; `--ink` = ground truth.

## Tech stack (decided — don't relitigate without asking)

| Layer | Choice | Why |
|---|---|---|
| Framework | React 18+ + TypeScript + Vite | Fast dev loop, ecosystem fit |
| Canvas/graph | `@xyflow/react` v12 (React Flow, 12.11.x as of Jul 2026) | Purpose-built for node editors; pan/zoom (d3-zoom), custom nodes/edges, minimap, `fitView`. Do NOT hand-roll an infinite canvas. |
| State | Zustand | React Flow already depends on it; one store for graph + session |
| Persistence | Dexie (IndexedDB), local-first | No backend for MVP; export/import JSON per session |
| LLM | Anthropic Messages API, streamed | See "Claude integration" below |
| Styling | Plain CSS modules or Tailwind (pick one at init, stay consistent) | |
| Math (gyakusan) | `mathjs` expression eval per node formula | Sandboxed, no `eval()` |

No Next.js, no server-side rendering, no auth for MVP. This is a local-first
single-user tool that later ships to nandedakke.com as a static site + tiny API
proxy.

## Data model

```ts
type Session = { id: string; title: string; mode: 'learn' | 'gyakusan';
                 createdAt: number; seqCounter: number };

type NodeKind = 'chunk'      // Claude's lesson step (spine)
              | 'question'   // user's なんで？ (branch) — stores the highlighted text
              | 'answer'     // Claude's reply to a question
              | 'playground' // interactive figure (self-contained JS component key + params)
              | 'goal' | 'variable' | 'derived'   // gyakusan
              | 'video';     // reserved, unimplemented

type RNode = {
  id: string; sessionId: string; kind: NodeKind;
  seq: number;                 // global monotonic order — the replay timeline
  position: {x:number; y:number};
  content: { md: string;       // markdown body (render with a md lib)
             highlights: Highlight[] };
  // gyakusan only:
  formula?: string;            // mathjs expr referencing other node ids by name
  value?: number; unit?: string;
};

type Highlight = { id: string; start: number; end: number;  // char offsets into md source
                   text: string;                            // denormalized quote (offset drift guard)
                   childNodeId?: string };                  // the question node it spawned

type EdgeKind = 'next'    // chronological spine chunk→chunk
             | 'why'      // parent node → question node (labeled with the highlighted phrase)
             | 'reply'    // question → answer
             | 'depends'; // gyakusan dataflow (source feeds target's formula)
```

`seq` is the single source of truth for replay AND for "chronological order of
what I asked". Never reuse or renumber. Layout position is separate from order —
auto-layout may move nodes, seq never changes.

## Core features & acceptance criteria

### 1. Infinite canvas (MVP)
- Pan/zoom/minimap/fit-view via React Flow. Custom node components per `kind`.
- Auto-layout: spine flows left→right at fixed y; `why` branches stack below
  their anchor's parent, offset by depth. User can drag nodes; store positions.
- 60fps pan with 200+ nodes. If it stutters, virtualize node content
  (collapse markdown bodies when zoomed out — render title-only "LOD").

### 2. Highlight → なんで？ button (MVP, the signature interaction)
- Selecting text inside a node's rendered markdown shows a floating
  「なんで？」button at the selection (like Medium's highlight menu).
- Clicking it: (a) persists a `Highlight` with char offsets into the md source
  (map DOM Range → source offsets; the denormalized `text` field is the fallback
  if offsets drift after edits), (b) creates a `question` node + `why` edge,
  (c) opens a compose box pre-filled with the quoted text — user can just send
  "why is this the case?" (default) or type their own question,
  (d) streams Claude's answer into a linked `answer` node.
- The highlight stays visually marked in the parent node (pink underline,
  `--branch`), clickable → camera pans to its question node. Bidirectional.
- Recursion must work: highlighting inside an `answer` node spawns a deeper
  `question`. No depth limit.

### 3. Claude integration (MVP)
- Teaching flow: user gives a topic → Claude returns the lesson **one chunk at a
  time** (Socratic style — small chunk, then wait; do not dump 10 chunks at
  once). Each accepted chunk becomes a spine node with a `next` edge.
- Use the Messages API with streaming; render tokens into the node live.
- Context sent per question = the ancestor chain (root chunk → … → highlighted
  parent → the quoted highlight), NOT the whole graph. Keeps prompts small and
  answers anchored.
- API key handling: dev = key in `.env.local` hitting a 20-line Express/Hono
  proxy (`/api/chat` → `api.anthropic.com`). **Never ship the key to the
  browser in production.** Verify current API/SDK specifics against
  https://docs.claude.com/en/api/overview before writing the client — do not
  code SDK usage from memory.
- Structured output: ask the model to return `{chunkTitle, md, checkQuestion?}`
  JSON for lesson chunks so nodes are well-formed.

### 4. Replay (MVP)
- Play button: hide all nodes, then reveal in `seq` order, one per beat
  (~1.2s default, speed control ×0.5/×1/×2), camera smoothly panning to each
  new node (`setCenter` with easing). Edges draw in with the target node.
- Scrubber: a timeline slider over seq range; dragging shows the graph state at
  that point. Pause/resume. Esc exits replay.
- This is the "how did my understanding actually build up" feature — treat it as
  first-class, not an afterthought.

### 5. Playground nodes (Phase 1.5)
- A `playground` node references a registered React component
  (`registry[key]`) + serializable params. Start with a generic
  "sliders + canvas draw function" component matching the old graph-explainer
  playgrounds. Known pitfall from previous work: store canvas base height in
  `dataset.baseH` on first fit — re-reading `height` after DPR scaling
  compounds the scale on every redraw. Redraw on `input`, `change`, `resize`.
  Always show a plain-language verdict line above the canvas.

### 6. Gyakusan mode (Phase 2)
- `goal` node with target expression; `variable` nodes (slider or number
  input, min/max/step/unit); `derived` nodes with `formula` evaluated by
  mathjs over incoming `depends` edges (topological order; reject cycles with
  a visible error badge, don't crash).
- Editing any variable recomputes and animates every downstream value
  (<16ms for graphs <100 nodes — it's just arithmetic).
- Claude assist: "decompose this goal" → Claude proposes the dependency tree as
  JSON `{nodes, edges, formulas}` → user reviews before it's inserted.
- Example fixture to ship: FIRE-by-35 (current age, net worth, savings rate,
  income, return %, withdrawal rate 4% → required portfolio → required monthly
  savings). Include a disclaimer node: educational model, not financial advice.

## Conventions

- TypeScript strict. No `any` in the data model.
- All graph mutations go through Zustand actions that also write to Dexie
  (write-behind, debounced 300ms). The store is the truth; Dexie is durability.
- Every session exportable/importable as one JSON file (schema-versioned:
  `{schemaVersion: 1, session, nodes, edges}`).
- Markdown rendering: `react-markdown` + KaTeX for math. Sanitize — node
  content comes from an LLM.
- Sandboxing: playground components are first-party code only for now. If/when
  LLM-generated interactive HTML is supported, it goes in a sandboxed iframe
  (`sandbox="allow-scripts"`, no same-origin). Never `dangerouslySetInnerHTML`
  LLM output outside that iframe.
- Undo/redo for graph edits (React Flow docs list `useUndoable` patterns —
  check current docs, don't reinvent).
- Language: UI copy may mix Japanese/English (なんで？ button, リプレイ). Keep
  strings in one `strings.ts` for later i18n.
- Commit style: small commits, imperative subject, one feature per PR-sized
  change.

## Commands

```bash
npm run dev        # Vite dev server + proxy (concurrently)
npm run build      # typecheck + vite build
npm run test       # vitest — cover: seq ordering, highlight offset mapping,
                   # gyakusan recompute (incl. cycle rejection), JSON round-trip
npm run lint       # eslint + prettier check
```

## Build order (do these in sequence; each milestone runs standalone)

1. Scaffold: Vite + React + TS + React Flow rendering hardcoded spine/branch
   fixture with the palette. Pan/zoom/minimap working.
2. Data layer: Zustand + Dexie, session CRUD, JSON export/import, seq counter.
3. Highlight → なんで？ interaction with a **mocked** Claude (canned answers).
   Get the selection→offset mapping and bidirectional highlight↔node linking
   solid before touching the API.
4. Real Claude streaming via proxy; chunked teaching flow.
5. Replay.
6. Playground node type + one real playground.
7. Gyakusan mode + FIRE fixture.

## Don'ts

- Don't build an Obsidian-style force-directed association graph. Ever.
- Don't dump the whole lesson at once; chunk-by-chunk is the pedagogy.
- Don't renumber `seq`, don't derive order from positions.
- Don't put the Anthropic API key in client-shipped code.
- Don't add a backend/database/auth before the local-first MVP works.
- Don't guess Anthropic API details — check https://docs.claude.com first.
