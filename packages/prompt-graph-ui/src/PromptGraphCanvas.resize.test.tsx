// @module-tag dom
import { parsePromptTree, toGraphModel } from '@prompt-studio/prompts';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
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

it('#2498: exposes resize handles for the host-selected expanded section and hides them when collapsed', () => {
  const model = toGraphModel(parsePromptTree({ key: 'resize', text: '<mission>\nRead the document.\n</mission>' }));
  const section = model.nodes.find((node) => node.kind === 'section')!;
  const { container } = render(<PromptGraphCanvas model={model} selectedNodeId={section.id} />);
  const node = container.querySelector<HTMLElement>('.react-flow__node-section')!;
  expect(node.querySelector('.react-flow__resize-control.handle')).not.toBeNull();
  expect(node.querySelector<HTMLElement>('.react-flow__resize-control.handle')!.style.backgroundColor).toBe(
    'var(--foreground)',
  );
  fireEvent.click(within(node).getByRole('button', { name: 'Collapse section' }));
  expect(node.querySelector('.react-flow__resize-control.handle')).toBeNull();
  fireEvent.click(within(node).getByRole('button', { name: 'Expand section' }));
  expect(node.querySelector('.react-flow__resize-control.handle')).not.toBeNull();
});

it('#2536: uncontrolled native selection also shows section selection and structure actions', () => {
  const model = toGraphModel(parsePromptTree({ key: 'drag', text: '<mission>\nRead.\n</mission>' }));
  const onAddChildSection = vi.fn();
  const { container } = render(<PromptGraphCanvas model={model} onAddChildSection={onAddChildSection} />);
  const node = container.querySelector<HTMLElement>('.react-flow__node-section')!;
  fireEvent.click(node);
  expect(node.classList.contains('selected')).toBe(true);
  expect(within(node).getByRole('article').getAttribute('data-selected')).toBe('true');
  fireEvent.click(within(node).getByRole('button', { name: 'Add sub-section' }));
  expect(onAddChildSection).toHaveBeenCalledWith(model.nodes.find((entry) => entry.kind === 'section')!.id);
});
