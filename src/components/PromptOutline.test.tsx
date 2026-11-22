// @module-tag dom
import { parsePromptTree } from '@prompt-studio/prompts';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptOutline } from './PromptOutline';

afterEach(cleanup);
const sections = parsePromptTree({
  key: 'example',
  text: '# Mission\nInstructions.\n## Evidence\nVerify facts.\n# Output\nReturn JSON.\n',
  toolNames: [],
}).children;
function props() {
  return {
    sections,
    onSelect: vi.fn(),
    onEdit: vi.fn(),
    onAddAfter: vi.fn(),
    onAddChild: vi.fn(),
    onMove: vi.fn(),
    onRemove: vi.fn(),
  };
}

it('navigates a nested outline with arrows and selects with the keyboard', async () => {
  const actions = props();
  render(<PromptOutline {...actions} />);
  const mission = screen.getByRole('treeitem', { name: 'Mission' });
  const user = userEvent.setup();
  await user.click(mission);
  await user.keyboard('{ArrowRight}');
  await waitFor(() => expect(screen.getByRole('treeitem', { name: 'Evidence' })).toHaveFocus());
  await user.keyboard('{ArrowLeft}');
  await waitFor(() => expect(mission).toHaveFocus());
  await user.keyboard('{ArrowLeft}');
  await waitFor(() => expect(screen.queryByRole('treeitem', { name: 'Evidence' })).not.toBeInTheDocument());
  await user.keyboard('{End}');
  const output = screen.getByRole('treeitem', { name: 'Output' });
  await waitFor(() => expect(output).toHaveFocus());
  await user.keyboard('{Enter}');
  expect(actions.onSelect).toHaveBeenCalledWith(`section:${sections[1].id}`);
});

it('names a new sub-section before sending it through the shared structure command', async () => {
  const actions = props();
  render(<PromptOutline {...actions} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Section actions' }));
  await user.click(screen.getByRole('menuitem', { name: 'Add sub-section' }));
  await user.type(screen.getByRole('textbox', { name: 'Section name' }), 'verified_evidence');
  await user.click(screen.getByRole('button', { name: /^Add section$/ }));
  expect(actions.onAddChild).toHaveBeenCalledWith(`section:${sections[0].id}`, 'verified_evidence');
});

it('keeps actions on a selected child after its parent is collapsed', async () => {
  const actions = props();
  const child = sections[0].children[0];
  render(<PromptOutline {...actions} selectedNodeId={`section:${child.id}`} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Collapse Mission' }));
  expect(screen.queryByRole('treeitem', { name: 'Evidence' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Section actions' }));
  await user.click(screen.getByRole('menuitem', { name: 'Edit section' }));
  expect(actions.onEdit).toHaveBeenCalledWith(`section:${child.id}`);
});

it('disables moves beyond the selected section sibling boundaries', async () => {
  const actions = props();
  render(<PromptOutline {...actions} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Section actions' }));
  expect(screen.getByRole('menuitem', { name: 'Move section up' })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('menuitem', { name: 'Move section down' })).not.toHaveAttribute('aria-disabled', 'true');
});

it('restores focus to a surviving ancestor when a focused section is removed by a source edit', async () => {
  const actions = props();
  const view = render(<PromptOutline {...actions} />);
  const child = screen.getByRole('treeitem', { name: 'Evidence' });
  await userEvent.setup().click(child);
  view.rerender(<PromptOutline {...actions} sections={[{ ...sections[0], children: [] }, sections[1]]} />);
  await waitFor(() => expect(screen.getByRole('treeitem', { name: 'Mission' })).toHaveFocus());
  expect(screen.getByRole('treeitem', { name: 'Mission' })).toHaveAttribute('tabindex', '0');
});

it('reveals an externally selected child without taking focus from the writing workspace', async () => {
  const actions = props();
  const child = sections[0].children[0];
  const view = render(<PromptOutline {...actions} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Collapse Mission' }));
  const writer = document.createElement('textarea');
  document.body.append(writer);
  writer.focus();
  try {
    view.rerender(<PromptOutline {...actions} selectedNodeId={`section:${child.id}`} />);
    expect(await screen.findByRole('treeitem', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true');
    expect(writer).toHaveFocus();
  } finally {
    writer.remove();
  }
});

it('keeps an empty outline reachable when source edits remove its final focused section', async () => {
  const actions = props();
  const view = render(<PromptOutline {...actions} />);
  await userEvent.setup().click(screen.getByRole('treeitem', { name: 'Output' }));
  actions.onSelect.mockClear();
  view.rerender(<PromptOutline {...actions} sections={[]} />);
  const tree = screen.getByRole('tree', { name: 'Prompt sections' });
  await waitFor(() => expect(tree).toHaveFocus());
  await userEvent.setup().keyboard('{ArrowDown}{Home}{Enter}');
  expect(actions.onSelect).not.toHaveBeenCalled();
});
