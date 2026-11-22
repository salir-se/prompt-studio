// @module-tag dom
import { describe, expect, it } from 'vitest';
import type { PromptContentSource } from './prompt-content-source';
import { buildToolDirectory } from './tool-directory';

/** Two prompts' tool lists, sharing `create_ticket`, as a project's content source would report them. */
const contentSource: PromptContentSource = {
  getPromptText: () => null,
  getToolSourceLists: () => [
    {
      source: 'support-triage',
      tools: [
        { name: 'lookup_customer', description: 'Find the customer record by email.', inputKeys: ['email'] },
        { name: 'create_ticket', description: 'Open a support ticket.', inputKeys: ['category', 'urgency'] },
      ],
    },
    {
      source: 'release-notes',
      tools: [
        { name: 'list_changes', inputKeys: [] },
        { name: 'create_ticket', description: 'A second description that loses.', inputKeys: ['summary'] },
      ],
    },
  ],
};

describe('buildToolDirectory', () => {
  it('is sorted by name and has no duplicate names', () => {
    // Given / When: the directory built from two prompts' tool lists
    const directory = buildToolDirectory(contentSource);

    // Then: one entry per tool name, in name order
    const names = directory.map((entry) => entry.name);
    expect(names).toEqual(['create_ticket', 'list_changes', 'lookup_customer']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('is deterministic across calls', () => {
    // Given / When / Then: building twice from the same source gives the same directory
    expect(buildToolDirectory(contentSource)).toEqual(buildToolDirectory(contentSource));
  });

  it('merges sources for a tool shared by two prompts, keeping the first definition', () => {
    // Given: `create_ticket` is listed by both prompts
    // When: the directory is built
    const entry = buildToolDirectory(contentSource).find((candidate) => candidate.name === 'create_ticket');

    // Then: one entry names both sources (sorted) and keeps the first-seen description and input keys
    expect(entry?.sources).toEqual(['release-notes', 'support-triage']);
    expect(entry?.description).toBe('Open a support ticket.');
    expect(entry?.inputKeys).toEqual(['category', 'urgency']);
  });

  it('narrows input keys and description per tool kind (a tool may have neither)', () => {
    // Given / When: the directory built from tools with and without descriptions
    const directory = buildToolDirectory(contentSource);

    // Then: every entry has an input-key array and an optional string description
    for (const entry of directory) {
      expect(Array.isArray(entry.inputKeys)).toBe(true);
      expect(entry.description === undefined || typeof entry.description === 'string').toBe(true);
    }
    expect(directory.find((candidate) => candidate.name === 'list_changes')?.description).toBeUndefined();
  });

  it('is empty when no project tool lists are available', () => {
    // Given: the default bridge-backed source before any prime
    // When / Then: the directory is empty, never wrong
    expect(buildToolDirectory()).toEqual([]);
  });
});
