// @module-tag dom
import { describe, expect, it } from 'vitest';
import { selectTopFaq } from './selectTopFaq';
import type { FaqItem } from './types';

const item = (id: string, over: Partial<FaqItem> = {}): FaqItem => ({
  id,
  question: 'q',
  answer: 'a',
  ...over,
});

describe('selectTopFaq', () => {
  it('limits to N items (default 5)', () => {
    const items = Array.from({ length: 20 }, (_, i) => item(`q${i}`));
    expect(selectTopFaq(items)).toHaveLength(5);
    expect(selectTopFaq(items, { limit: 3 })).toHaveLength(3);
  });

  it('ranks pinned first, then popularity, then priority, then authored order', () => {
    const items = [item('a'), item('b', { priority: 10 }), item('c', { pinned: true }), item('d')];
    const order = selectTopFaq(items, { popularity: { d: 99 }, limit: 4 }).map((i) => i.id);
    expect(order).toEqual(['c', 'd', 'b', 'a']);
  });

  it('excludes gated items before ranking', () => {
    const items = [item('a'), item('hidden', { hidden: true }), item('b', { flag: 'beta' })];
    expect(selectTopFaq(items).map((i) => i.id)).toEqual(['a']);
    expect(selectTopFaq(items, { featureFlag: () => true }).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('preserves authored order as the final tiebreak', () => {
    const items = [item('first'), item('second'), item('third')];
    expect(selectTopFaq(items).map((i) => i.id)).toEqual(['first', 'second', 'third']);
  });
});
