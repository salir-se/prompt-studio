// @module-tag dom
import { describe, expect, it } from 'vitest';
import { filterFaq } from './filterFaq';
import type { FaqItem } from './types';

const item = (over: Partial<FaqItem> & Pick<FaqItem, 'id'>): FaqItem => ({
  question: 'q',
  answer: 'a',
  ...over,
});

describe('filterFaq', () => {
  it('drops hidden items', () => {
    const out = filterFaq([item({ id: 'a' }), item({ id: 'b', hidden: true })]);
    expect(out.map((i) => i.id)).toEqual(['a']);
  });

  it('drops flagged items unless the flag is on', () => {
    const items = [item({ id: 'plain' }), item({ id: 'gated', flag: 'beta' })];
    expect(filterFaq(items).map((i) => i.id)).toEqual(['plain']);
    expect(filterFaq(items, { featureFlag: (k) => k === 'beta' }).map((i) => i.id)).toEqual(['plain', 'gated']);
  });

  it('keeps experiment items only on the matching variant', () => {
    const items = [item({ id: 'exp', experiment: { key: 'wording', variant: 'B' } })];
    expect(filterFaq(items, { getVariant: () => 'A' })).toHaveLength(0);
    expect(filterFaq(items, { getVariant: () => 'B' }).map((i) => i.id)).toEqual(['exp']);
    // No resolver → experiment item is dropped (variant is undefined !== 'B').
    expect(filterFaq(items)).toHaveLength(0);
  });

  it('drops unpublished / expired items (G9 governance)', () => {
    const now = new Date('2026-06-08T00:00:00Z');
    const items = [
      item({ id: 'live' }), // no meta → published
      item({ id: 'published', meta: { status: 'published' } }),
      item({ id: 'draft', meta: { status: 'draft' } }),
      item({ id: 'expired', meta: { status: 'published', expiresAt: '2026-01-01T00:00:00Z' } }),
    ];
    expect(filterFaq(items, { now }).map((i) => i.id)).toEqual(['live', 'published']);
  });
});
