// @module-tag pure
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLlm, installLlmTransport, LlmTransportError, type LlmTransportRequest } from './llm-transport';

const request = (): LlmTransportRequest => ({
  provider: 'anthropic',
  url: 'https://api.anthropic.com/v1/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    Authorization: 'Bearer private-bearer',
    'x-api-key': 'private-key',
    'x-private': 'private-header',
  },
  body: '{"system":"private prompt","messages":[]}',
  context: { agent: 'closer', runId: 'run-1', leadId: 'lead-1' },
});
let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

describe('opt-in raw LLM transport', () => {
  it('leaves native response, errors and inactive request validation unchanged', async () => {
    const response = new Response('raw');
    const send = vi.fn(async () => response);
    expect(await fetchLlm({ ...request(), url: 'legacy-url?key=secret' }, send, new AbortController().signal)).toBe(
      response,
    );
    expect(send).toHaveBeenCalledTimes(1);
    const failure = new TypeError('offline');
    await expect(fetchLlm(request(), () => Promise.reject(failure), new AbortController().signal)).rejects.toBe(
      failure,
    );
  });

  it('passes an owned frozen credential-free descriptor and the exact signal before sending', async () => {
    const input = request();
    const signal = new AbortController().signal;
    const response = new Response('raw');
    const send = vi.fn(async () => response);
    let captured: LlmTransportRequest | undefined;
    dispose = installLlmTransport(async (descriptor, nativeSend, actualSignal) => {
      captured = descriptor;
      expect(send).not.toHaveBeenCalled();
      expect(actualSignal).toBe(signal);
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(Object.isFrozen(descriptor.headers)).toBe(true);
      expect(Object.isFrozen(descriptor.context)).toBe(true);
      return nativeSend();
    });
    expect(await fetchLlm(input, send, signal)).toBe(response);
    expect(captured).toEqual({
      ...input,
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
    });
    expect(captured?.body).toBe(input.body);
    expect(JSON.stringify(captured)).not.toMatch(/private-key|private-bearer|private-header/);
    expect(captured?.headers).not.toBe(input.headers);
    expect(captured?.context).not.toBe(input.context);
  });

  it.each([
    'https://user:secret@provider.test/messages',
    'https://provider.test/messages?api_key=secret',
    'https://provider.test/messages#secret',
    'data:text/plain,secret',
    'invalid-url',
  ])('rejects an unsafe active descriptor without publishing it: %s', async (url) => {
    const handler = vi.fn();
    const send = vi.fn();
    dispose = installLlmTransport(handler);
    await expect(fetchLlm({ ...request(), url }, send, new AbortController().signal)).rejects.toBeInstanceOf(
      LlmTransportError,
    );
    expect(handler).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('allows replay without native send or consuming the response stream', async () => {
    const response = new Response('saved raw bytes');
    const send = vi.fn();
    dispose = installLlmTransport(async () => response);
    expect(await fetchLlm(request(), send, new AbortController().signal)).toBe(response);
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe('saved raw bytes');
    expect(send).not.toHaveBeenCalled();
  });

  it('does not replay or publish a request when its signal is already aborted', async () => {
    const caller = new AbortController();
    caller.abort();
    const handler = vi.fn(async () => new Response('saved raw bytes'));
    const send = vi.fn();
    dispose = installLlmTransport(handler);
    await expect(fetchLlm(request(), send, caller.signal)).rejects.toBe(caller.signal.reason);
    expect(handler).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not return a saved response after cancellation while the handler is pending', async () => {
    const caller = new AbortController();
    const send = vi.fn();
    dispose = installLlmTransport(async () => {
      caller.abort();
      return new Response('saved raw bytes');
    });
    await expect(fetchLlm(request(), send, caller.signal)).rejects.toBe(caller.signal.reason);
    expect(send).not.toHaveBeenCalled();
  });

  it('makes journal failures permanent and never falls back to native send', async () => {
    const failure = new TypeError('private journal details');
    const send = vi.fn();
    dispose = installLlmTransport(async () => {
      throw failure;
    });
    await expect(fetchLlm(request(), send, new AbortController().signal)).rejects.toMatchObject({
      name: 'LlmTransportError',
      message: 'LLM transport handler failed',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([Error, LlmTransportError])('does not expose protected journal error details: %s', async (ErrorType) => {
    dispose = installLlmTransport(async () => {
      throw new ErrorType('private raw response and credentials');
    });
    const error = await fetchLlm(request(), vi.fn(), new AbortController().signal).catch((err) => err);
    expect(error).toBeInstanceOf(LlmTransportError);
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain('private raw response');
  });

  it('preserves a native rejection identity through a forwarding handler', async () => {
    const failure = new TypeError('native network failure');
    dispose = installLlmTransport(async (_request, send) => send());
    await expect(fetchLlm(request(), () => Promise.reject(failure), new AbortController().signal)).rejects.toBe(
      failure,
    );
  });

  it('preserves the exact caller cancellation reason from a pending journal', async () => {
    const controller = new AbortController();
    const reason = new DOMException('cancelled', 'AbortError');
    dispose = installLlmTransport(async () => {
      controller.abort(reason);
      throw reason;
    });
    await expect(fetchLlm(request(), vi.fn(), controller.signal)).rejects.toBe(reason);
  });

  it('keeps a distinct journal fault permanent when the caller also aborts', async () => {
    const controller = new AbortController();
    dispose = installLlmTransport(async () => {
      controller.abort();
      throw new Error('private journal failure');
    });
    await expect(fetchLlm(request(), vi.fn(), controller.signal)).rejects.toMatchObject({
      name: 'LlmTransportError',
      message: 'LLM transport handler failed',
    });
  });

  it('rejects duplicate sends and closes an unused send after replay', async () => {
    const response = new Response('raw');
    const send = vi.fn(async () => response);
    dispose = installLlmTransport(async (_request, nativeSend) => {
      const result = await nativeSend();
      await expect(nativeSend()).rejects.toBeInstanceOf(LlmTransportError);
      return result;
    });
    await fetchLlm(request(), send, new AbortController().signal);
    expect(send).toHaveBeenCalledTimes(1);
    dispose();
    let lateSend: (() => Promise<Response>) | undefined;
    dispose = installLlmTransport(async (_request, nativeSend) => {
      lateSend = nativeSend;
      return response;
    });
    await fetchLlm(request(), send, new AbortController().signal);
    await expect(lateSend?.()).rejects.toBeInstanceOf(LlmTransportError);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps the pending handler across disposal and makes old disposal identity-safe', async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = new Response('first');
    const next = new Response('next');
    const send = vi.fn(async () => first);
    dispose = installLlmTransport(async (_request, nativeSend) => {
      await waiting;
      return nativeSend();
    });
    const oldDispose = dispose;
    expect(() => installLlmTransport(async () => next)).toThrow(/already installed/);
    const pending = fetchLlm(request(), send, new AbortController().signal);
    oldDispose();
    dispose = installLlmTransport(async () => next);
    oldDispose();
    release?.();
    expect(await pending).toBe(first);
    expect(await fetchLlm(request(), send, new AbortController().signal)).toBe(next);
    dispose();
    expect(await fetchLlm(request(), send, new AbortController().signal)).toBe(first);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
