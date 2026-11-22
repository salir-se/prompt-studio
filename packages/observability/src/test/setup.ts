// Turnkey vitest setup file for any package that wants the silence-on-pass /
// dump-on-fail console capture. Wire up by adding this file to setupFiles
// in your vitest.config.ts:
//
//   setupFiles: ['@prompt-studio/observability/test/setup']
//
// If you need filtering (e.g. ignore React's "not wrapped in act" warnings
// because a separate guard tracks them) call installConsoleSilencer(opts)
// from your own setup file instead of importing this side-effect module.

import { afterEach, beforeEach } from 'vitest';
import { clearLoggerContext, setLogLevel } from '../pino-logger';
import { installConsoleSilencer } from './console-silencer';
import { assertNoBlockedNetworkRequests, clearBlockedNetworkRequests, installNetworkGuard } from './network-guard';

installConsoleSilencer();
// happy-dom is large. Loading it in every isolated Node test file added ~28%
// to a representative package even though the installer immediately returned.
if (typeof window !== 'undefined') {
  const { installHappyDomStorage } = await import('./happy-dom-storage');
  installHappyDomStorage();
}
// Mandatory onUnhandledRequest:'error' semantics for the whole fleet: any
// network request not handled by a suite's MSW server or fetch stub throws
// instantly and is RECORDED, so a refactor that introduces new data fetches
// surfaces the complete inventory in one failure (see network-guard.ts).
installNetworkGuard();

function resetLoggerForTest(): void {
  clearLoggerContext();
  setLogLevel('silent');
}

resetLoggerForTest();

beforeEach(() => {
  resetLoggerForTest();
  clearBlockedNetworkRequests();
});

afterEach(() => {
  try {
    assertNoBlockedNetworkRequests();
  } finally {
    resetLoggerForTest();
  }
});
