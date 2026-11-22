// @module-tag pure
import { describe, expect, it } from 'vitest';
import { promptDesignSections, promptSectionId } from './prompt-design-sections';
import { parsePromptTree } from './tree/parse-tree';

describe('source-native design sections', () => {
  it('covers Markdown bodies without turning a title container into an empty section', () => {
    const text = '# Summary\n\n## Instructions\nSummarize {{document}}.\n\n## Output\nCite evidence.\n';
    const tree = parsePromptTree({ key: 'summary', text, toolNames: [] });
    const sections = promptDesignSections(tree.children);
    expect(sections.map((section) => section.title)).toEqual(['Instructions', 'Output']);
    expect(sections.map((section) => promptSectionId('summary', section))).toEqual([
      'summary#summary/instructions',
      'summary#summary/output',
    ]);
    expect(tree.text).toBe(text);
  });

  it('retains existing XML identities without duplicating paired headings', () => {
    const tree = parsePromptTree({
      key: 'summary',
      text: '## Instructions\n\n<instructions>\nSummarize.\n</instructions>\n',
      toolNames: [],
    });
    expect(promptDesignSections(tree.children).map((section) => promptSectionId('summary', section))).toEqual([
      'summary.instructions',
    ]);
  });

  it('ignores apparent sections inside code fences and distinguishes repeated headings', () => {
    const tree = parsePromptTree({
      key: 'summary',
      text: '## Step\nFirst.\n\n```md\n## Example\n```\n\n## Step\nSecond.\n',
      toolNames: [],
    });
    const ids = promptDesignSections(tree.children).map((section) => promptSectionId('summary', section));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

it('keeps frontmatter as source metadata without reporting it as unattached prose', () => {
  const text = '---\nname: summary\ndescription: Summarize\n---\n# Summary\n## Instructions\nSummarize.';
  const tree = parsePromptTree({ key: 'summary', text, toolNames: [] });
  expect(tree.diagnostics).toEqual([]);
  expect(tree.text).toBe(text);
});
