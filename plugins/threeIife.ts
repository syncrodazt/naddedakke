import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

// three.js, as one self-contained script that defines a THREE global.
//
// A generated 3D figure runs in a sandboxed iframe with no network at all, so
// there is nothing for `import * as THREE from 'three'` to reach and no CDN to
// fall back on: the library has to be inside the document. three ships ESM only
// (three.module.js imports from three.core.js), so it is bundled here into an
// IIFE and handed over as source text.
//
// Built rather than vendored: a 700KB minified blob checked into the repo goes
// stale against package.json silently, and nobody reviews it. Cached on disk by
// three's version so a dev server restart does not rebuild it.

const VIRTUAL_ID = 'virtual:three-iife';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

/**
 * A cache key for the installed three.
 *
 * Its own file contents, not its version string: `three/package.json` is not in
 * the package's `exports` map so it cannot be required, and hashing the build
 * invalidates on exactly the thing that matters — the code changing — including
 * a patched or linked copy that reports the same version.
 */
function threeFingerprint(root: string): string {
  const require = createRequire(resolve(root, 'package.json'));
  const entry = require.resolve('three');
  return createHash('sha1').update(readFileSync(entry)).digest('hex').slice(0, 16);
}

async function buildThree(root: string): Promise<string> {
  const cacheFile = resolve(
    root,
    'node_modules/.cache/nandedakke',
    `three-${threeFingerprint(root)}.js`,
  );
  try {
    return readFileSync(cacheFile, 'utf8');
  } catch {
    // not built yet
  }

  const entry = resolve(root, 'node_modules/.cache/nandedakke/three-entry.js');
  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(entry, "export * from 'three';\n");

  // Imported lazily: pulling Vite's build API into the module graph at config
  // load time is a needless cost for every command that never touches 3D.
  const { build } = await import('vite');
  const result = await build({
    configFile: false, // never re-enter this config — that would recurse
    logLevel: 'error',
    build: {
      write: false,
      minify: true,
      lib: { entry, formats: ['iife'], name: 'THREE', fileName: 'three' },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs
    .flatMap((o) => ('output' in o ? o.output : []))
    .find((o) => o.type === 'chunk');
  if (!chunk || !('code' in chunk)) throw new Error('could not bundle three.js');

  writeFileSync(cacheFile, chunk.code);
  return chunk.code;
}

export function threeIife(): Plugin {
  let root = process.cwd();
  let cached: Promise<string> | null = null;
  return {
    name: 'nandedakke-three-iife',
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return null;
      cached ??= buildThree(root);
      return `export default ${JSON.stringify(await cached)};`;
    },
  };
}
