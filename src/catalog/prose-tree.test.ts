// @module-tag dom
import { parsePromptTree } from '@prompt-studio/prompts';
import { describe, expect, it } from 'vitest';
import { ensureSectionedTree } from './prose-tree';

/**
 * The prose fallback (task #17): a parse with zero sections gets ONE synthetic section covering
 * the full document, so fragment documents (icp/persona/discovery_protocol — plain prose) get a
 * canvas card, an inspector, and a working edit path. Sectioned and empty documents pass through
 * untouched.
 */

describe('ensureSectionedTree', () => {
  it('synthesizes one full-range section for a prose document with variables collected', () => {
    const text =
      'Target product and engineering organizations.\nPrioritize {{product_name}} signals and {{product_name}} funding.';
    const tree = ensureSectionedTree(parsePromptTree({ key: 'icp', text, toolNames: [] }));

    expect(tree.children).toHaveLength(1);
    const [node] = tree.children;
    expect(node.id).toBe('prose-document');
    expect(node.title).toBe('Document');
    expect(node.depth).toBe(1);
    expect(node.text).toBe(text);
    expect(node.range).toEqual({ start: 0, end: text.length });
    expect(node.variables).toEqual(['product_name']); // deduped
    expect(tree.maxDepth).toBe(1);
  });

  it('passes a sectioned document through untouched', () => {
    const text = '# Heading one\nbody\n\n# Heading two\nmore body';
    const parsed = parsePromptTree({ key: 'scout', text, toolNames: [] });
    expect(parsed.children.length).toBeGreaterThan(0);
    expect(ensureSectionedTree(parsed)).toBe(parsed);
  });

  it('passes an empty document through untouched (nothing to render, nothing to edit)', () => {
    const parsed = parsePromptTree({ key: 'x', text: '   ', toolNames: [] });
    expect(parsed.children).toHaveLength(0);
    expect(ensureSectionedTree(parsed)).toBe(parsed);
  });
});
