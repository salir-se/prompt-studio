// @module-tag pure
import { expect, it } from 'vitest';
import { assertAdoptionDestinations } from './adoption-destinations';

it('allows identical save retries and explicit adaptation while refusing unrelated overwrites', () => {
  const archive = {
    format: 'prompt-studio-project-files@1' as const,
    name: 'Test',
    files: [{ path: 'prompts/task.md', base64: btoa('Saved source') }],
  };
  expect(() => assertAdoptionDestinations([{ path: 'prompts/task.md', text: 'Changed' }], archive)).toThrow(
    /already exists/,
  );
  expect(() => assertAdoptionDestinations([{ path: 'prompts/task.md', text: 'Saved source' }], archive)).not.toThrow();
  expect(() =>
    assertAdoptionDestinations([{ path: 'prompts/task.md', text: 'Changed' }], archive, 'prompts/task.md'),
  ).not.toThrow();
});
