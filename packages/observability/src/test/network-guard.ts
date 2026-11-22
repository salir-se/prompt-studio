/**
 * Fleet-wide "no real network in unit tests" guard — the global enforcement of
 * MSW's `onUnhandledRequest: 'error'` semantics, applied even to suites that
 * run no MSW server at all.
 *
 * Why: a unit test with a hidden network dependency fails by DNS LUCK, not by
 * contract — locally the resolver returns fast NXDOMAIN and the test passes;
 * on a CI runner where the lookup stalls, vitest's 5s timeout fires and an
 * otherwise-green pipeline dies (PR #319: services/license routes.contract
 * probes fetched `https://billing.salir.test` unstubbed and flaked four times
 * in one day). This guard converts that whole failure class into an instant,
 * deterministic error naming the offending request.
 *
 * TRACKABILITY — refactors introduce new data fetches; discovering them one
 * throw at a time would make every refactor a whack-a-mole of test failures.
 * So the guard RECORDS every blocked attempt per test and:
 *   - every thrown error carries the COMPLETE inventory of attempts so far in
 *     the current test (a component firing three fetches shows all three in
 *     the first failure — add all three handlers in one pass);
 *   - the shared setup fails the test in afterEach with a consolidated
 *     `[network-guard] blocked N request(s)` report, even if production code
 *     caught the fetch error and returned a fallback;
 *   - tests can assert on attempts explicitly via
 *     `getBlockedNetworkRequests()` (cleared automatically between tests).
 *
 * Composition (verified order-of-installation semantics):
 *  - setupFiles run BEFORE suite hooks, so the guard becomes the "real fetch"
 *    that MSW captures on `server.listen()`. Handled requests are answered by
 *    MSW; unhandled requests under `onUnhandledRequest: 'error'` throw in MSW;
 *    and any passthrough (`'bypass'`/`'warn'`) lands HERE and throws anyway —
 *    which is exactly what makes 'error' semantics mandatory, not advisory.
 *  - `vi.stubGlobal('fetch', …)` suites replace the guard for their scope and
 *    get it back via `vi.unstubAllGlobals()`.
 *  - Hono `app.fetch(request, env)` invocations are direct function calls and
 *    never touch the global — worker integration tests are unaffected.
 *  - `data:`/`blob:` URLs pass through to the original fetch (no network).
 *
 * Escape hatch for debugging only: SALIR_TEST_ALLOW_NETWORK=1.
 */

const GUARD_FLAG = Symbol.for('salir.test.networkGuard');

export interface BlockedNetworkRequest {
  method: string;
  url: string;
  /** 1-based order of the attempt within the current test. */
  order: number;
}

const blocked: BlockedNetworkRequest[] = [];

/** Attempts blocked since the last clear (the shared setup clears per test). */
export function getBlockedNetworkRequests(): ReadonlyArray<BlockedNetworkRequest> {
  return [...blocked];
}

export function clearBlockedNetworkRequests(): void {
  blocked.length = 0;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === 'object' && 'method' in input && typeof input.method === 'string') {
    return input.method.toUpperCase();
  }
  return 'GET';
}

export function formatBlockedReport(requests: ReadonlyArray<BlockedNetworkRequest>): string {
  return requests.map((r) => `  ${r.order}. ${r.method} ${r.url}`).join('\n');
}

/** Fail closed after a test, including when production code caught the guard error. */
export function assertNoBlockedNetworkRequests(): void {
  const attempts = getBlockedNetworkRequests();
  clearBlockedNetworkRequests();
  if (attempts.length > 0) {
    throw new Error(
      `[network-guard] blocked ${attempts.length} network request(s) in this test:\n${formatBlockedReport(attempts)}`,
    );
  }
}

export function installNetworkGuard(): void {
  if (process.env.SALIR_TEST_ALLOW_NETWORK === '1') return;
  const real = globalThis.fetch;
  // No global fetch in this runtime, or guard already installed — nothing to do.
  if (typeof real !== 'function' || (real as { [GUARD_FLAG]?: boolean })[GUARD_FLAG]) return;

  const guard = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (url.startsWith('data:') || url.startsWith('blob:')) return real(input, init);
    blocked.push({ method: requestMethod(input, init), url, order: blocked.length + 1 });
    throw new Error(
      `[network-guard] unit test attempted a real network request — all attempts in this test so far:\n` +
        `${formatBlockedReport(blocked)}\n` +
        'Unit tests must not depend on DNS or live services. Handle these requests in your ' +
        "suite's MSW server (onUnhandledRequest: 'error'), stub fetch (vi.stubGlobal), or inject a " +
        'fake service binding/adapter. Assert on attempts via getBlockedNetworkRequests() from ' +
        "'@prompt-studio/observability/test'. See packages/observability/src/test/network-guard.ts.",
    );
  };
  (guard as unknown as { [GUARD_FLAG]: boolean })[GUARD_FLAG] = true;
  Object.defineProperty(globalThis, 'fetch', { value: guard, writable: true, configurable: true });
}
