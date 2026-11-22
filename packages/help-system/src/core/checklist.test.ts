// @module-tag dom
import { describe, expect, it } from 'vitest';
import { type ChecklistDefinition, checklistProgress } from './checklist';

const def: ChecklistDefinition = {
  id: 'getting-started',
  title: 'Getting started',
  items: [
    { id: 'key', label: 'Add an API key', completionMilestone: 'config.api_key_set' },
    { id: 'scout', label: 'Run Scout', pageKey: 'Scout', tourId: 'Scout', completionMilestone: 'scout.run' },
    { id: 'send', label: 'Send outreach', completionMilestone: 'outreach.sent' },
  ],
};

describe('checklistProgress', () => {
  it('marks items done by fired milestone and counts progress', () => {
    const progress = checklistProgress(def, new Set(['config.api_key_set']));
    expect(progress.items.map((i) => i.done)).toEqual([true, false, false]);
    expect(progress.doneCount).toBe(1);
    expect(progress.total).toBe(3);
    expect(progress.complete).toBe(false);
  });

  it('suggests the first not-done item as nextItem', () => {
    const progress = checklistProgress(def, new Set(['config.api_key_set']));
    expect(progress.nextItem?.id).toBe('scout');
  });

  it('is complete when every milestone has fired', () => {
    const all = new Set(['config.api_key_set', 'scout.run', 'outreach.sent']);
    const progress = checklistProgress(def, all);
    expect(progress.complete).toBe(true);
    expect(progress.doneCount).toBe(3);
    expect(progress.nextItem).toBeUndefined();
  });

  it('an empty checklist is not complete', () => {
    expect(checklistProgress({ id: 'x', title: 'X', items: [] }, new Set()).complete).toBe(false);
  });
});
