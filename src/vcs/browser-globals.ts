/**
 * Browser-runtime global shim for the in-memory git layer. isomorphic-git's
 * ESM browser build references the `Buffer` GLOBAL (76 call sites in 1.40.0)
 * without importing it — in Node/vitest that global exists, in a browser it
 * does not. This module installs the npm `buffer` and `process` polyfills
 * (reached through the builtin aliases in `../../vite.config.ts`). memfs
 * and path-browserify also need process.cwd/nextTick in the browser.
 *
 * Import this module FIRST, before anything that pulls in isomorphic-git
 * (see `spike-probe.ts`) — ES module order guarantees the global is in place
 * before any git code runs. Under vitest/node it is a harmless no-op.
 */

import { Buffer } from 'node:buffer';
import process from 'node:process';

if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}

if (typeof (globalThis as { process?: unknown }).process === 'undefined') {
  (globalThis as { process?: unknown }).process = process;
}
