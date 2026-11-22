// @module-tag dom
import type { PromptGraphModel } from '@prompt-studio/prompts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PromptGraphCanvas } from './PromptGraphCanvas';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('opens a file dependency through keyboard selection', () => {
  const onSelectNode = vi.fn();
  const model: PromptGraphModel = {
    nodes: [
      {
        id: 'file:references/rules.md',
        kind: 'file',
        label: 'references/rules.md',
        data: { kind: 'file', path: 'references/rules.md', loadBeforeBody: true },
      },
    ],
    edges: [],
  };
  render(<PromptGraphCanvas model={model} onSelectNode={onSelectNode} />);
  fireEvent.keyDown(screen.getByRole('group', { name: 'file: references/rules.md' }), { key: 'Enter' });
  expect(onSelectNode).toHaveBeenCalledWith('file:references/rules.md');
});

it('reactivates node details with Enter after the host dismisses the inspector', () => {
  const onSelectNode = vi.fn();
  const model: PromptGraphModel = {
    nodes: [{ id: 'variable:source', kind: 'variable', label: 'source', data: { kind: 'variable', name: 'source' } }],
    edges: [],
  };
  render(<PromptGraphCanvas model={model} onSelectNode={onSelectNode} />);
  const node = screen.getByRole('group', { name: 'variable: source' });
  fireEvent.click(node);
  onSelectNode.mockClear();
  fireEvent.keyDown(node, { key: 'Enter' });
  expect(onSelectNode).toHaveBeenCalledWith('variable:source');
});
