// @module-tag dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withPromptStructure } from '../../design/prompt-design-project';
import { SUPPORT_TRIAGE_TEXT, supportTriageRoot } from '../../test-fixtures/starter-catalog';
import { runRootVerification } from '../root-verification';
import { useSemanticReview } from './use-semantic-review';

beforeEach(() => {
  const meta = document.createElement('meta');
  meta.name = 'studio-token';
  meta.content = 'test';
  document.head.appendChild(meta);
});
afterEach(() => {
  document.querySelector('meta[name="studio-token"]')?.remove();
  vi.unstubAllGlobals();
});
function fixture() {
  const root = withPromptStructure(supportTriageRoot(), SUPPORT_TRIAGE_TEXT);
  const result = runRootVerification(root, SUPPORT_TRIAGE_TEXT);
  if (!result) throw new Error('Missing result');
  return result;
}

it('keeps completed reviews attached to their scope while another scope is inspected', async () => {
  // Given: a completed review of one section.
  const result = fixture();
  const first = result.sections.find((section) => section.profile.principles.length > 0);
  if (!first) throw new Error('Missing AI criteria');
  const second = result.sections.find((section) => section.sectionId !== first.sectionId);
  if (!second) throw new Error('Missing alternate scope');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true, model: 'test', findings: [] }))),
  );
  const hook = renderHook(() => useSemanticReview(result));
  await act(async () => {
    await hook.result.current.run(first);
  });
  // Then: inspecting another scope cannot relabel or erase the first section's review.
  expect(hook.result.current.forSection(first).status).toBe('results');
  expect(hook.result.current.forSection(second).status).toBe('idle');
  expect(hook.result.current.forSection(first).model).toBe('test');
});

it('drops an in-flight response when check definitions change even if source text is unchanged', async () => {
  // Given: a provider is still reviewing the old criteria.
  const result = fixture();
  const section = result.sections.find((section) => section.profile.principles.length > 0);
  if (!section) throw new Error('Missing criteria');
  let resolve!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const hook = renderHook(({ result }) => useSemanticReview(result), { initialProps: { result } });
  act(() => {
    void hook.result.current.run(section);
  });
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  // When: the same text receives a new profile version before the response arrives.
  hook.rerender({
    result: { ...result, profiles: result.profiles.map((profile) => ({ ...profile, version: profile.version + 1 })) },
  });
  await act(async () => {
    resolve(new Response(JSON.stringify({ ok: true, model: 'obsolete', findings: [] })));
  });
  // Then: the old result cannot make the new criteria appear reviewed.
  expect(hook.result.current.forSection(section).status).toBe('idle');
  expect(hook.result.current.busy).toBe(false);
});

it('retains completed evidence as stale coverage after the prompt changes', async () => {
  const result = fixture();
  const section = result.sections.find((section) => section.profile.principles.length > 0)!;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true, model: 'test', findings: [] }))),
  );
  const hook = renderHook(({ value }) => useSemanticReview(value), {
    initialProps: { value: result as typeof result | null },
  });
  await act(async () => {
    await hook.result.current.run(section);
  });
  expect(hook.result.current.statusBySectionId[section.sectionId]).toBe('current');
  hook.rerender({ value: null });
  expect(hook.result.current.forSection(section).status).toBe('idle');
  expect(hook.result.current.statusBySectionId[section.sectionId]).toBe('stale');
});
it('starts only one paid review from repeated shortcuts before React rerenders', async () => {
  const result = fixture();
  const section = result.sections.find((section) => section.profile.principles.length > 0)!;
  let release!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const hook = renderHook(() => useSemanticReview(result));
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = hook.result.current.run(section);
    second = hook.result.current.run(section);
  });
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await act(async () => {
    release(new Response(JSON.stringify({ ok: true, model: 'test', findings: [] })));
    await Promise.all([first, second]);
  });
});
