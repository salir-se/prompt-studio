// @module-tag dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowPatternPicker } from './WorkflowPatternPicker';
import { WORKFLOW_PATTERNS } from './workflow-patterns';

describe('workflow pattern selection', () => {
  it('cancels a preview without changing the workflow and restores focus', async () => {
    const onUse = vi.fn();
    const user = userEvent.setup();
    render(<WorkflowPatternPicker onUse={onUse} />);
    const trigger = screen.getByRole('button', { name: 'Choose pattern' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(onUse).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });
  it('explains draft replacement and lets the author cancel without applying a pattern', async () => {
    const onUse = vi.fn();
    const user = userEvent.setup();
    render(<WorkflowPatternPicker onUse={onUse} currentWorkflow="flowchart LR\nCustom --> Result" />);
    await user.click(screen.getByRole('button', { name: 'Choose pattern' }));
    expect(screen.getByRole('note')).toHaveTextContent('replaces your current workflow draft');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onUse).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Choose pattern' })).toHaveFocus();
  });
  it('previews with the keyboard and inserts only on explicit use', async () => {
    const onUse = vi.fn();
    const user = userEvent.setup();
    render(<WorkflowPatternPicker onUse={onUse} />);
    await user.click(screen.getByRole('button', { name: 'Choose pattern' }));
    await user.click(screen.getByRole('tab', { name: 'Routing' }));
    expect(onUse).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Routing graph preview')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Use pattern' }));
    expect(onUse).toHaveBeenCalledWith(WORKFLOW_PATTERNS.find((p) => p.id === 'routing')?.graph);
  });

  it('uses the arrow-key preview with a scoped shortcut and restores the trigger', async () => {
    // Given: a parent form must not receive the pattern confirmation chord.
    const onUse = vi.fn();
    const parent = vi.fn();
    const user = userEvent.setup();
    render(
      <form onKeyDown={parent}>
        <WorkflowPatternPicker onUse={onUse} />
      </form>,
    );
    const trigger = screen.getByRole('button', { name: 'Choose pattern' });
    await user.click(trigger);
    // When: the author previews the fourth pattern without a second menu.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'Parallel work (diamond)' })).toHaveFocus();
    expect(onUse).not.toHaveBeenCalled();
    parent.mockClear();
    await user.keyboard('{Control>}{Enter}{/Control}');
    // Then: only the explicit confirmation inserts it, and focus returns.
    expect(onUse).toHaveBeenCalledExactlyOnceWith(WORKFLOW_PATTERNS[3].graph);
    expect(trigger).toHaveFocus();
    expect(parent.mock.calls.some(([event]) => event.key === 'Enter')).toBe(false);
  });
});
