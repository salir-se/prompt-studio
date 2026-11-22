// @module-tag pure
import { describe, expect, it } from 'vitest';
import { parsePromptTree } from './parse-tree';
import { projectCanonicalPromptTree } from './project-canonical-tree';

const TEXT = `# Agent
<agent>
Intro text.

## Mission
<mission>
Use web_search with {{query}}.
</mission>

## Workflow
<workflow>
STEPS:
1. Search.
2. Save.
</workflow>
</agent>`;

describe('projectCanonicalPromptTree', () => {
  it('projects each canonical heading and stable tag as one editable section', () => {
    const parsed = parsePromptTree({ key: 'agent', text: TEXT, toolNames: ['web_search'] });
    const projected = projectCanonicalPromptTree(parsed, [
      { tag: 'agent', heading: 'Agent' },
      { tag: 'mission', heading: 'Mission' },
      { tag: 'workflow', heading: 'Workflow' },
    ]);

    expect(projected.children).toHaveLength(1);
    expect(projected.children[0]).toMatchObject({ title: 'Agent', tag: 'agent', delimiter: 'xml-tag' });
    expect(projected.children[0].children.map((node) => node.title)).toEqual(['Mission', 'Workflow']);
    expect(projected.children[0].children[0]).toMatchObject({
      text: 'Use web_search with {{query}}.\n',
      variables: ['query'],
      toolMentions: ['web_search'],
    });
    expect(projected.children[0].children[1].text).toContain('STEPS:');
    expect(projected.children[0].children[1].children).toEqual([]);
  });

  it('keeps user-authored sections that are outside canonical tagged sections', () => {
    const parsed = parsePromptTree({
      key: 'agent',
      text: `## Preferred hiring signal

Prioritize companies matching {{delegation_signal}}.

${TEXT}`,
      toolNames: ['web_search'],
    });
    const projected = projectCanonicalPromptTree(parsed, [
      { tag: 'agent', heading: 'Agent' },
      { tag: 'mission', heading: 'Mission' },
      { tag: 'workflow', heading: 'Workflow' },
    ]);

    expect(projected.children.map((node) => node.title)).toEqual(['Preferred hiring signal', 'Agent']);
    expect(projected.children[0]).toMatchObject({
      delimiter: 'atx-heading',
      variables: ['delegation_signal'],
    });
  });
});
