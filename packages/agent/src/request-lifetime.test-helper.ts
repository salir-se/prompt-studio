function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

export function stalledJsonFetch(): {
  fetch: (_input: unknown, init: RequestInit) => Promise<Response>;
  bodyStarted: Promise<void>;
  requestSignal: () => AbortSignal;
  settle: () => void;
} {
  let signal: AbortSignal | undefined;
  let resolveStarted: () => void = () => {};
  let rejectBody: (_error: Error) => void = () => {};
  const bodyStarted = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });

  return {
    fetch: async (_input, init) => {
      signal = init.signal as AbortSignal;
      return {
        ok: true,
        status: 200,
        json: () => {
          resolveStarted();
          return new Promise((_resolve, reject) => {
            rejectBody = reject;
            signal?.addEventListener('abort', () => reject(signal?.reason ?? abortError()), { once: true });
          });
        },
      } as Response;
    },
    bodyStarted,
    requestSignal: () => {
      if (!signal) throw new Error('fetch has not started');
      return signal;
    },
    settle: () => rejectBody(abortError()),
  };
}

export function streamResponseThenError(chunk?: string, error: Error = new TypeError('stream failed')): Response {
  const encoded = chunk ? new TextEncoder().encode(chunk) : undefined;
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (encoded && !sent) {
        sent = true;
        controller.enqueue(encoded);
        return;
      }
      controller.error(error);
    },
  });
  return { ok: true, status: 200, body } as Response;
}

export function stalledStreamFetch(): {
  fetch: (_input: unknown, init: RequestInit) => Promise<Response>;
  bodyStarted: Promise<void>;
  requestSignal: () => AbortSignal;
  settle: () => void;
} {
  let signal: AbortSignal | undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let resolveStarted: () => void = () => {};
  const bodyStarted = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
    pull() {
      resolveStarted();
    },
  });

  return {
    fetch: async (_input, init) => {
      signal = init.signal as AbortSignal;
      signal.addEventListener(
        'abort',
        () => {
          if (signal?.reason?.name === 'TimeoutError') streamController?.error(signal.reason);
          else streamController?.close();
        },
        { once: true },
      );
      return { ok: true, status: 200, body } as Response;
    },
    bodyStarted,
    requestSignal: () => {
      if (!signal) throw new Error('fetch has not started');
      return signal;
    },
    settle: () => {
      try {
        streamController?.close();
      } catch {
        // Already settled by the request signal.
      }
    },
  };
}
