// @module-tag dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { type ChecklistDefinition, checklistProgress } from '../core/checklist';
import { Checklist } from './Checklist';

const def: ChecklistDefinition = {
  id: 'getting-started',
  title: 'Getting started',
  items: [
    { id: 'key', label: 'Add an API key', completionMilestone: 'config.api_key_set' },
    { id: 'scout', label: 'Run Scout', pageKey: 'Scout', tourId: 'Scout', completionMilestone: 'scout.run' },
  ],
};

describe('Checklist', () => {
  it('renders progress and a done/undone state per item', () => {
    render(<Checklist progress={checklistProgress(def, new Set(['config.api_key_set']))} />);
    expect(screen.getByText('1 of 2 done')).toBeInTheDocument();
    expect(screen.getByText('Add an API key')).toBeInTheDocument();
    expect(screen.getByText('Run Scout')).toBeInTheDocument();
  });

  it('offers Start only for an incomplete item with a page/tour, and calls onStartItem', async () => {
    const onStartItem = vi.fn();
    render(<Checklist progress={checklistProgress(def, new Set(['config.api_key_set']))} onStartItem={onStartItem} />);
    // The done "key" item has no Start; the undone "scout" item does.
    const startButtons = screen.getAllByRole('button', { name: 'Start' });
    expect(startButtons).toHaveLength(1);
    await userEvent.click(startButtons[0]);
    expect(onStartItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'scout' }));
  });
});
