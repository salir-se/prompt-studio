/**
 * The studio's CONTROL HUB (ADR-236; tasks #18–#20): routes commands from programmatic clients
 * (CLI, MCP server) to the ONE connected editor tab and back. The editor's source of truth is
 * the browser — IndexedDB history provider, React working state — so external clients drive the
 * REAL app through this relay rather than a second, headless copy of the state (which would
 * immediately fork from what the user sees).
 *
 * Pure and transport-free by design (same discipline as fs-bridge.ts): the hub knows nothing
 * about HTTP/SSE — callers hand it an `emit` callback per connected tab and feed it parsed
 * response bodies. Everything here is unit-testable without a server.
 *
 * ONE client at a time (v1): a second attach REPLACES the first — the most recently opened tab
 * owns the editor, matching how a developer actually works. Commands while no tab is attached
 * reject immediately with the actionable "no editor connected" error.
 */

export const NO_CLIENT_ERROR = 'No editor tab is connected — open the prompt studio in a browser first.';

export interface ControlCommandRequest {
  readonly command: string;
  readonly args?: unknown;
}

export interface ControlResponse {
  readonly id: number;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** Default relay timeout — a tab that never answers must not hang a CLI/MCP caller forever. */
export const CONTROL_COMMAND_TIMEOUT_MS = 30_000;

export class ControlHub {
  private emit: ((payload: ControlCommandRequest & { id: number }) => void) | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = CONTROL_COMMAND_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /** Registers the connected tab; returns its detach function. A new attach replaces the old tab. */
  attachClient(emit: (payload: ControlCommandRequest & { id: number }) => void): () => void {
    this.emit = emit;
    return () => {
      // Only detach if THIS client is still the attached one — a stale tab closing must not
      // disconnect its replacement.
      if (this.emit === emit) {
        this.emit = null;
      }
    };
  }

  hasClient(): boolean {
    return this.emit !== null;
  }

  /** Relays one command to the connected tab; rejects on timeout, no client, or the tab's error. */
  submit(request: ControlCommandRequest): Promise<unknown> {
    if (this.emit === null) {
      return Promise.reject(new Error(NO_CLIENT_ERROR));
    }
    const id = this.nextId++;
    const payload = { ...request, id };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Editor did not answer "${request.command}" within ${this.timeoutMs}ms.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.emit?.(payload);
    });
  }

  /**
   * Feeds one parsed response body from the tab. Returns false for an unknown id (a response
   * racing a timeout, or a duplicate) — silently ignored, never a crash of the relay.
   */
  receiveResponse(body: unknown): boolean {
    if (typeof body !== 'object' || body === null) return false;
    const { id, ok, result, error } = body as ControlResponse;
    if (typeof id !== 'number' || !Number.isInteger(id)) return false;
    const pending = this.pending.get(id);
    if (pending === undefined) return false;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (ok === true) {
      pending.resolve(result);
    } else {
      pending.reject(new Error(typeof error === 'string' && error.length > 0 ? error : 'Editor command failed.'));
    }
    return true;
  }

  /** Rejects everything still pending (server shutdown) so no caller hangs on a dead relay. */
  dispose(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Control relay shut down.'));
    }
    this.pending.clear();
    this.emit = null;
  }
}
