/**
 * The browser half of the control channel (ADR-236; tasks #18–#20): connects the editor tab to
 * the server's SSE command stream and answers each command through the same app handlers the UI
 * uses — so a CLI/MCP client drives the REAL editor (its provider, its working state), never a
 * parallel copy.
 *
 * Degrade-to-silent by design: with no studio token (vitest, no dev server) or no EventSource,
 * the channel simply stays closed — the studio works exactly as before. Transport failures are
 * logged once, never surfaced as app errors.
 *
 * Browser-safe: no node imports; `x-studio-token` duplicated as a local constant per the
 * bridge-client convention (see bridge-content-source.ts's module doc).
 */

const STUDIO_TOKEN_HEADER = 'x-studio-token';

/** One command's implementation — the SAME handlers the UI drives, registered by the App. */
export type ControlHandler = (args: unknown) => unknown | Promise<unknown>;

export interface ControlCommandPayload {
  readonly id: number;
  readonly command: string;
  readonly args?: unknown;
}

function readStudioToken(): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('meta[name="studio-token"]')?.getAttribute('content') ?? null;
}

async function postResponse(id: number, ok: boolean, payload: unknown, token: string): Promise<void> {
  await fetch('/__control/response', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [STUDIO_TOKEN_HEADER]: token },
    body: JSON.stringify(ok ? { id, ok: true, result: payload ?? null } : { id, ok: false, error: String(payload) }),
  });
}

/**
 * Opens the channel with a command RESOLVER; returns a close function. A resolver (not a static
 * handler map) lets the App keep one connection for its whole lifetime while each dispatch reads
 * the latest handlers — no reconnect churn on every state change. Safe to call once per mount; a
 * second tab connecting REPLACES it server-side (the hub's newest-tab-wins rule).
 */
export function connectControlChannel(resolve: (command: string) => ControlHandler | undefined): () => void {
  if (typeof document === 'undefined' || typeof EventSource === 'undefined') return () => {};
  const token = readStudioToken();
  if (!token) return () => {};

  const source = new EventSource(`/__control/events?token=${encodeURIComponent(token)}`);
  source.onmessage = (event: MessageEvent<string>) => {
    let payload: ControlCommandPayload | null = null;
    try {
      payload = JSON.parse(event.data) as ControlCommandPayload;
    } catch {
      return; // A malformed frame from our own server — ignore rather than erroring the tab.
    }
    if (payload === null || typeof payload.id !== 'number' || typeof payload.command !== 'string') return;

    const handler = resolve(payload.command);
    if (handler === undefined) {
      void postResponse(payload.id, false, `Unknown command "${payload.command}".`, token);
      return;
    }
    Promise.resolve()
      .then(() => handler(payload.args))
      .then((result) => postResponse(payload.id, true, result ?? null, token))
      .catch((error: unknown) => {
        // The handler's message is the CLI/MCP user's diagnostic — readable, never a stack dump.
        const message = error instanceof Error ? error.message : String(error);
        void postResponse(payload.id, false, message, token);
      });
  };
  source.onerror = () => {
    // EventSource auto-reconnects; nothing to do. A permanently dead server takes the tab with it.
  };
  return () => source.close();
}
