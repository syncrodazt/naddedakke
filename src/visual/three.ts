// three.js source, fetched only when a figure actually needs it.
//
// A dynamic import so Vite splits it into its own chunk: 700KB is a real cost,
// and a notebook of 2D figures should never download it. Cached after the first
// 3D figure, because every later one wants the identical string.
let cached: Promise<string> | null = null;

export function loadThree(): Promise<string> {
  cached ??= import('virtual:three-iife').then((m) => m.default);
  return cached;
}
