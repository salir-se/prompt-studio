// @module-tag pure
import { describe, expect, it, vi } from 'vitest';
import { StreamedToolCalls } from './streamed-tool-calls';

describe('StreamedToolCalls', () => {
  it('opens one block per key and reports only the first sighting as new', () => {
    const calls = new StreamedToolCalls();

    const first = calls.open(0, 'call_a', 'firecrawl_search');
    const second = calls.open(0, undefined, 'firecrawl_search');

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.block).toBe(first.block);
  });

  it('keeps two calls to the SAME tool apart, whatever order their fragments arrive in', () => {
    const calls = new StreamedToolCalls();
    const a = calls.open(0, 'call_a', 'firecrawl_search').block;
    const b = calls.open(1, 'call_b', 'firecrawl_search').block;

    calls.append(0, '{"query":');
    calls.append(1, '{"query":');
    calls.append(1, '"funding"}');
    calls.append(0, '"hiring"}');
    calls.finalize();

    expect(a.input).toEqual({ query: 'hiring' });
    expect(b.input).toEqual({ query: 'funding' });
  });

  it('fills in an id or name that a later fragment supplies', () => {
    const calls = new StreamedToolCalls();

    const { block } = calls.open(0, undefined, undefined);
    calls.open(0, 'call_a', 'save_lead');

    expect(block.id).toBe('call_a');
    expect(block.name).toBe('save_lead');
  });

  it('synthesises a stable id when the provider never sends one', () => {
    // The API rejects a `tool_use` block whose id has no matching
    // `tool_result`, so an id-less call still needs something to pair on.
    const calls = new StreamedToolCalls();

    expect(calls.open(2, undefined, 'save_lead').block.id).toBe('call_2');
    expect(calls.idFor(2)).toBe('call_2');
  });

  it('leaves input as {} and reports the block when the buffered JSON is malformed', () => {
    const calls = new StreamedToolCalls();
    const { block } = calls.open(0, 'call_a', 'save_lead');
    const onParseError = vi.fn();

    calls.append(0, '{"domain":');
    calls.finalize(onParseError);

    expect(block.input).toEqual({});
    expect(onParseError).toHaveBeenCalledExactlyOnceWith(block);
  });

  it('ignores a fragment for a key that was never opened instead of throwing', () => {
    const calls = new StreamedToolCalls();

    expect(() => calls.append(7, '{"x":1}')).not.toThrow();
    expect(calls.idFor(7)).toBeUndefined();
  });

  it('routes an index-less fragment to the call still being built (pre-index behavior)', () => {
    // A stream that sends no index has no other identity to offer, and its
    // fragments are sequential by construction. Targeting the most recently
    // opened call reproduces exactly what the positional accumulator did.
    const calls = new StreamedToolCalls();
    const a = calls.open(0, 'call_a', 'firecrawl_search').block;

    calls.append(undefined, '{"query":"hiring"}');
    const b = calls.open(1, 'call_b', 'firecrawl_search').block;
    calls.append(undefined, '{"query":"funding"}');
    calls.finalize();

    expect(a.input).toEqual({ query: 'hiring' });
    expect(b.input).toEqual({ query: 'funding' });
    expect(calls.idFor(undefined)).toBe('call_b');
  });

  it('drops an index-less fragment that arrives before any call was opened', () => {
    const calls = new StreamedToolCalls();

    expect(() => calls.append(undefined, '{"x":1}')).not.toThrow();
    expect(calls.idFor(undefined)).toBeUndefined();
  });

  it('does not report a parse error for a call that carried no arguments at all', () => {
    const calls = new StreamedToolCalls();
    const { block } = calls.open(0, 'call_a', 'get_pipeline_stats');
    const onParseError = vi.fn();

    calls.finalize(onParseError);

    expect(block.input).toEqual({});
    expect(onParseError).not.toHaveBeenCalled();
  });

  // Gemini thought_signature round trip (Google's OpenAI-compat surface):
  // `open()`'s 4th param carries a vendor payload (`ContentBlock.providerExtra`)
  // that must survive onto the finalized block, per-key, whichever fragment
  // it lands on.
  it('carries a providerExtra payload from open() onto the block, distinct per key', () => {
    const calls = new StreamedToolCalls();
    const a = calls.open(0, 'call_a', 'query_data', { google: { thought_signature: 'sig-a' } }).block;
    const b = calls.open(1, 'call_b', 'query_data', { google: { thought_signature: 'sig-b' } }).block;

    expect(a.providerExtra).toEqual({ google: { thought_signature: 'sig-a' } });
    expect(b.providerExtra).toEqual({ google: { thought_signature: 'sig-b' } });
  });

  it('merges a later-arriving providerExtra payload onto an already-opened block', () => {
    const calls = new StreamedToolCalls();
    const { block } = calls.open(0, 'call_a', 'query_data');
    calls.open(0, undefined, undefined, { google: { thought_signature: 'sig-late' } });

    expect(block.providerExtra).toEqual({ google: { thought_signature: 'sig-late' } });
  });

  it('leaves providerExtra undefined when no extra payload is ever supplied', () => {
    const calls = new StreamedToolCalls();
    const { block } = calls.open(0, 'call_a', 'query_data');

    expect(block.providerExtra).toBeUndefined();
  });
});
