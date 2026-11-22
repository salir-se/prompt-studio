// ── Wire happy-dom's Storage into the test global ──────────────────────────
// happy-dom defines a spec-compliant Storage class (Proxy-backed; supports
// `Object.keys(storage)` enumeration). It lives on its BrowserWindow as
// prototype getters for `localStorage` / `sessionStorage`.
//
// vitest's happy-dom env copies properties from the BrowserWindow to the
// worker's `global` via `Object.getOwnPropertyNames(win)` — which skips
// prototype-only getters. Then `populateGlobal` further filters out keys
// already present on `global`, and Node 22+ installs a `localStorage` getter
// on `globalThis` by default (returns undefined without --localstorage-file).
// Net effect: Node's empty getter shadows happy-dom's real storage, so test
// code that touches `localStorage` / `window.localStorage` throws
// `Cannot read properties of undefined`.
//
// Install happy-dom's Storage directly on globalThis/window so test code gets
// the real spec-compliant implementation it expects.
import { Storage as HappyDomStorage } from 'happy-dom';

function installStorage(name: 'localStorage' | 'sessionStorage'): void {
  const storage = new HappyDomStorage();
  Object.defineProperty(globalThis, name, { value: storage, writable: true, configurable: true });
  if (typeof window !== 'undefined' && window !== globalThis) {
    Object.defineProperty(window, name, { value: storage, writable: true, configurable: true });
  }
}

/**
 * Install spec-compliant `localStorage` / `sessionStorage` globals backed by
 * happy-dom's Storage. No-op outside a DOM-like environment (no `window`), so
 * it is safe to call from a shared setup file that node-env packages also load.
 *
 * Wire it up in a vitest setup file:
 *
 *   import { installHappyDomStorage } from '@prompt-studio/observability/test';
 *   installHappyDomStorage();
 */
export function installHappyDomStorage(): void {
  if (typeof window === 'undefined') return; // node-env test — nothing to polyfill
  installStorage('localStorage');
  installStorage('sessionStorage');
}
