/**
 * Minimal WHATWG-`fetch`-compatible client built directly on `node:http`, used ONLY by this
 * server's own `@vitest-environment node` integration suites (`main.test.ts`, `verify.test.ts`) to
 * talk to the real `node:http` server THEY spin up on a loopback port for the duration of each test.
 *
 * Why not the global `fetch`: the fleet-wide network guard
 * (`@prompt-studio/observability/test/network-guard.ts`, wired in via this app's shared `test-setup.ts`)
 * replaces `globalThis.fetch` with a throwing stub for every request no suite explicitly handles —
 * correct for a genuine external dependency, but these two suites are the guard's own documented
 * escape hatch: "a suite that legitimately needs the real network replaces `fetch` for its scope".
 * Rather than stub in a canned response, this performs the REAL loopback request the test actually
 * needs — by going through `node:http` directly, it never touches the guarded global at all, so
 * there is nothing to stub/restore per test.
 */
import http from 'node:http';

export interface LoopbackResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  // Mirrors the real `Response.json()` signature (`Promise<any>`) — every caller destructures
  // specific fields off the parsed body immediately, exactly like the native fetch Response they
  // replace here (see the module doc above).
  json(): Promise<any>;
  text(): Promise<string>;
}

export interface LoopbackRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function toHeaderReader(headers: http.IncomingHttpHeaders): LoopbackResponse['headers'] {
  return {
    get(name: string): string | null {
      const value = headers[name.toLowerCase()];
      if (value === undefined) return null;
      return Array.isArray(value) ? value.join(', ') : value;
    },
  };
}

/** Drop-in for the subset of `fetch(url, init)` these two suites use: method, header map, string body. */
export function loopbackFetch(url: string, init: LoopbackRequestInit = {}): Promise<LoopbackResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: init.method ?? 'GET', headers: init.headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf-8');
        resolve({
          status: response.statusCode ?? 0,
          headers: toHeaderReader(response.headers),
          json: async () => JSON.parse(bodyText),
          text: async () => bodyText,
        });
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    if (init.body !== undefined) request.write(init.body);
    request.end();
  });
}
