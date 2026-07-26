# Canvas benchmark

CLAUDE.md sets a performance target — _"60fps pan with 200+ nodes"_ — and says to
virtualize node content if it stutters. This measures whether it does.

```bash
npm run bench            # builds nothing; run `npm run build` first
npm run bench:gen -- 400 # regenerate a fixture with a different node count
```

It drives the **production** build through `vite preview` with real Chromium,
imports a fixture through the app's own Import button, and samples `rAF` frame
deltas during pan, zoom and a node drag.

Absolute numbers depend on the machine. The number that means something is the
before/after on the same one, so re-run both sides when judging a change.

## What it found (240 nodes)

CLAUDE.md anticipated the wrong bottleneck. Panning was already at 60fps with
zero dropped frames; **dragging a node** was the broken interaction:

| interaction    | before                          | after                          |
| -------------- | ------------------------------- | ------------------------------ |
| pan            | 0% dropped                      | 0–1%                           |
| zoom out       | 3%                              | 3%                             |
| pan zoomed out | 3%                              | 0–1%                           |
| **drag node**  | **34%, p95 567ms, worst 783ms** | **1–2%, p95 17ms, worst 33ms** |

The cause was a chain, not a single line. Dragging writes the node's position to
the store on every pointer move; each write replaced the `nodes` map, which

1. handed React Flow 240 freshly-built node objects when only one had moved, and
2. re-rendered every `ChunkNode`/`AnswerNode`, because each subscribed to the
   whole map via `useGraphStore((s) => s.nodes)` — which in turn produced a new
   `resolvedHighlightIds` array, defeating `MarkdownContent`'s memo and
   re-parsing markdown + KaTeX for every node on screen.

Fixed by memoizing `toFlowNode` per `RNode` (`store/selectors.ts`) and selecting
a joined string instead of the node map (`canvas/nodes/useResolvedHighlights.ts`).

Each fix was verified by removing it and re-running: without the `toFlowNode`
memo the drag went back to 34% dropped; without the string selector it sat at 5%.
A third change — a custom `memo` comparator on `MarkdownContent` — measured as
making **no difference** once those two were in, so it was removed rather than
kept as decoration.

No LOD / content virtualization was needed. If a future change makes panning
stutter, that is the point to add it.
