import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { createStudioFsBridgePlugin } from './src/bridge/fs-bridge';

const dirname = path.dirname(fileURLToPath(import.meta.url));
// The dev server edits the prompt project at STUDIO_REPO_ROOT, or this checkout's example project.
const repoRoot = path.resolve(process.env.STUDIO_REPO_ROOT ?? path.join(dirname, 'examples/starter'));
// Without an explicit project, the dev server also uses the starter example's manifest.
const manifestPath =
  process.env.STUDIO_MANIFEST_PATH ??
  (process.env.STUDIO_REPO_ROOT ? undefined : path.join(dirname, 'examples/starter/studio.manifest.json'));

/**
 * Resolves a browser-polyfill package to an absolute path from THIS APP'S
 * dependency context. The four polyfills are declared in this package.json,
 * which is the only resolution bun's isolated linker guarantees — resolving
 * from memfs's store realpath instead breaks under `globalStore = true`,
 * where a package's cache-links directory cannot reach anything else
 * (memfs only ever dev-depended on these, so they were never its deps).
 * Used only for the `resolve.alias` entries.
 */
function polyfillResolve(specifier: string): string {
  return createRequire(import.meta.url).resolve(specifier);
}

export default defineConfig(() => ({
  // `tailwindcss()` gives the workspace UI packages' Tailwind classes (unstyled without
  // it — this app has no other CSS pipeline, see `src/index.css`'s module doc) a real stylesheet.
  plugins: [
    react(),
    tailwindcss(),
    // `STUDIO_MANIFEST_PATH` honors the same override in `bun run dev` as in the standalone
    // server (server/config.ts) — without passing it here the env var silently did nothing in
    // dev, so a manifest override could only ever be exercised in the container.
    createStudioFsBridgePlugin({
      repoRoot,
      appRoot: dirname,
      manifestPath,
    }),
  ],
  resolve: {
    // Browser polyfills for the node builtins `memfs` (via @jsonjoy.com/fs-node-builtins)
    // requires at runtime. In the browser Vite externalizes builtins into warn-only stubs
    // whose every property reads `undefined`, which breaks the in-memory git layer (src/vcs).
    // Each replacement is resolved to an absolute path so the alias works from ANY importer —
    // node_modules internals and app source (`src/vcs/browser-globals.ts`) alike. The trailing
    // slash on `buffer/`/`events/` forces npm-package resolution instead of the node builtin.
    //
    // BOTH spellings of each builtin must be aliased. Vite externalizes the bare specifier
    // (`require('buffer')`) exactly like the prefixed one, and older CJS transitives use the
    // bare form: isomorphic-git pulls in `safe-buffer`, whose `require('buffer').Buffer` is
    // `undefined` against the stub — it throws on `Buffer.from` at module scope and takes the
    // whole git provider down to `SimpleHistoryProvider`. Aliasing only `node:buffer` leaves
    // that path broken, and the fallback is silent apart from a banner, so it is easy to miss.
    alias: [
      { find: /^(node:)?buffer$/, replacement: polyfillResolve('buffer/') },
      { find: /^(node:)?events$/, replacement: polyfillResolve('events/') },
      { find: /^(node:)?path$/, replacement: polyfillResolve('path-browserify') },
      { find: /^(node:)?stream$/, replacement: polyfillResolve('readable-stream') },
      // readable-stream already depends on the browser process implementation. Resolve from
      // its dependency context so Bun's isolated/global store does not require a hoisted copy.
      {
        find: /^(node:)?process$/,
        replacement: createRequire(polyfillResolve('readable-stream')).resolve('process/browser'),
      },
    ],
  },
  server: {
    // SECURITY BOUNDARY, not a preference. This dev server will eventually read and
    // serve repository file contents (prompt source files, and later a filesystem
    // bridge) to whatever connects to it. Binding to '127.0.0.1' keeps it reachable
    // only from this machine. Never widen this to '0.0.0.0' or a LAN-visible host —
    // doing so would expose repository contents to the local network.
    host: '127.0.0.1',
    port: 5273,
    strictPort: true,
  },
}));
