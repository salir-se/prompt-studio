// @module-tag pure
import { createBlankPromptDesign } from '@prompt-studio/prompts';
import { expect, it } from 'vitest';
import { revisedVerificationDesign } from './verification-editing';

it('revises only edited check definitions while preserving contracts and unrelated profiles', () => {
  // Given: authored contracts and a profile with one criterion.
  const blank = createBlankPromptDesign({ id: 'test', title: 'Test' }).design;
  const first = blank.verificationProfiles[0];
  const criterion = {
    id: 'evidence',
    version: 1,
    owner: 'configuration' as const,
    statement: 'Cite sources.',
    severity: 'warning' as const,
    allowedCustomization: 'Author may revise.',
    sectionIds: [],
  };
  const original = {
    ...blank,
    verificationProfiles: blank.verificationProfiles.map((profile, index) =>
      index === 0 ? { ...profile, principles: [criterion] } : profile,
    ),
  };
  const draft = {
    ...original,
    verificationProfiles: original.verificationProfiles.map((profile, index) =>
      index === 0 ? { ...profile, principles: [{ ...criterion, statement: 'Cite primary sources.' }] } : profile,
    ),
  };
  // When: the check editor persists the draft.
  const saved = revisedVerificationDesign(original, draft);
  // Then: identities and other data survive; changed definitions receive a new version.
  expect(saved.version).toBe(original.version + 1);
  expect(saved.verificationProfiles[0].id).toBe(first.id);
  expect(saved.verificationProfiles[0].version).toBe(first.version + 1);
  expect(saved.verificationProfiles[0].principles[0].version).toBe(2);
  expect(saved.verificationProfiles.slice(1)).toEqual(original.verificationProfiles.slice(1));
  expect(saved.input).toEqual(original.input);
  expect(saved.output).toEqual(original.output);
  expect(saved.sectionDesigns).toEqual(original.sectionDesigns);
});

it('refuses to rewrite protected platform criteria', () => {
  // Given: a platform-owned criterion in an existing profile.
  const blank = createBlankPromptDesign({ id: 'test', title: 'Test' }).design;
  const criterion = {
    id: 'protected',
    version: 1,
    owner: 'platform' as const,
    statement: 'Preserve this.',
    severity: 'error' as const,
    allowedCustomization: 'Read-only.',
    sectionIds: [],
  };
  const original = {
    ...blank,
    verificationProfiles: blank.verificationProfiles.map((profile, index) =>
      index === 0 ? { ...profile, principles: [criterion] } : profile,
    ),
  };
  const draft = {
    ...original,
    verificationProfiles: original.verificationProfiles.map((profile, index) =>
      index === 0 ? { ...profile, principles: [] } : profile,
    ),
  };
  // Then: even a malformed draft cannot remove the protected criterion.
  expect(() => revisedVerificationDesign(original, draft)).toThrow('Protected platform criteria');
});
