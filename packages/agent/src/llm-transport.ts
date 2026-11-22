/** Private raw requests belong in an authorized journal, never in logs or UI events. */
export interface LlmTransportContext {
  readonly agent?: string;
  readonly runId?: string;
  readonly leadId?: string;
  readonly messageId?: string;
}

export interface LlmTransportRequest {
  readonly provider: string;
  readonly url: string;
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly context?: LlmTransportContext;
}

/** Persist before returning; saved Responses skip native send. Honor signal during pending I/O/stream reads. */
export type LlmTransportHandler = (
  request: LlmTransportRequest,
  send: () => Promise<Response>,
  signal: AbortSignal,
) => Promise<Response>;

/** A capture failure must never become an unrecorded retry or a model fallback. */
export class LlmTransportError extends Error {
  override readonly name = 'LlmTransportError';
}

let installed: { handler: LlmTransportHandler } | undefined;

/** Realm-local and exclusive. Disposing an old installation cannot remove a newer one. */
export function installLlmTransport(handler: LlmTransportHandler): () => void {
  if (installed) throw new LlmTransportError('LLM transport handler is already installed');
  const registration = { handler };
  installed = registration;
  return () => {
    if (installed === registration) installed = undefined;
  };
}

function snapshot(request: LlmTransportRequest): LlmTransportRequest {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw new LlmTransportError('Unsafe LLM transport endpoint');
  }
  // Instrumented endpoints cannot carry credentials in userinfo, query or fragment.
  // Keep the original safe URL bytes for exact-request matching.
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new LlmTransportError('Unsafe LLM transport endpoint');
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    if (lower === 'content-type' || lower === 'anthropic-version' || lower === 'anthropic-beta') {
      headers[lower] = value;
    }
  }
  const context: Record<string, string> = {};
  for (const key of ['agent', 'runId', 'leadId', 'messageId'] as const) {
    const value = request.context?.[key];
    if (value !== undefined) context[key] = value;
  }
  return Object.freeze({
    provider: request.provider,
    url: request.url,
    method: request.method,
    headers: Object.freeze(headers),
    body: request.body,
    ...(request.context ? { context: Object.freeze(context) } : {}),
  });
}

/** Internal fetch-site seam. `send` alone closes over network credentials/proxy envelopes. */
export async function fetchLlm(
  request: LlmTransportRequest,
  send: () => Promise<Response>,
  signal: AbortSignal,
  captureSupported = true,
): Promise<Response> {
  const registration = installed;
  if (!registration) return send();
  signal.throwIfAborted();
  if (!captureSupported) throw new LlmTransportError('Raw LLM capture is unavailable for this transport');
  const descriptor = snapshot(request);
  let sent = false;
  let closed = false;
  let nativeFailed = false;
  let nativeFailure: unknown;
  const nativeSend = async (): Promise<Response> => {
    if (sent || closed) throw new LlmTransportError('LLM transport send is no longer available');
    sent = true;
    try {
      return await send();
    } catch (err) {
      nativeFailed = true;
      nativeFailure = err;
      throw err;
    }
  };
  let response: Response;
  try {
    response = await registration.handler(descriptor, nativeSend, signal);
  } catch (err) {
    // A forwarding journal must preserve native TypeError/AbortError identity
    // so the existing retry and cancellation machinery still owns those errors.
    if (nativeFailed && err === nativeFailure) throw err;
    // Journal I/O can observe caller cancellation before any native send/read.
    // An unrelated journal fault remains permanent even if the signal also aborted.
    if (signal.aborted && err === signal.reason) throw err;
    // Logger serializers walk Error.cause. The adapter owns protected failure
    // details; even an adapter-thrown LlmTransportError gets a safe public error.
    throw new LlmTransportError('LLM transport handler failed');
  } finally {
    closed = true;
  }
  // Saved responses must not revive a call cancelled while the handler awaited.
  // Keep cancellation outside the handler-failure wrapper to retain its identity.
  signal.throwIfAborted();
  return response;
}
