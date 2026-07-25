import { defineConfig } from 'vite';

// The MCP server is bundled rather than compiled file-by-file with tsc so it can
// import the app's own modules — layout placement, the gyakusan engine — instead
// of reimplementing them. Two copies of "where does a branch node go" would
// drift, and the copy the assistant writes through is the one the learner sees.
//
// SSR build: node_modules stay external, only first-party code is bundled.
export default defineConfig({
  build: {
    ssr: 'mcp/index.ts',
    outDir: 'mcp/dist',
    emptyOutDir: true,
    target: 'node20',
    minify: false, // a readable stack trace beats a few kilobytes here
    copyPublicDir: false, // public/ is the web app's, not the server's
    rollupOptions: {
      output: {
        format: 'esm',
        entryFileNames: 'index.js',
        // Rollup drops the source shebang; put it back so the file is directly
        // executable, not only via `node …`.
        banner: '#!/usr/bin/env node',
      },
    },
  },
});
