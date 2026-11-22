// @module-tag dom
import { describe, expect, it } from 'vitest';
import { isPublished, staleContent } from './governance';
import type { HelpContent } from './types';

const NOW = new Date('2026-06-08T00:00:00Z');
const PAST = '2026-01-01T00:00:00Z';
const FUTURE = '2027-01-01T00:00:00Z';

describe('isPublished', () => {
  it('treats absent meta as published (back-compat)', () => {
    expect(isPublished(undefined, NOW)).toBe(true);
  });

  it('treats explicit published, non-expired as published', () => {
    expect(isPublished({ status: 'published' }, NOW)).toBe(true);
    expect(isPublished({ status: 'published', expiresAt: FUTURE }, NOW)).toBe(true);
  });

  it('hides draft / review / archived', () => {
    expect(isPublished({ status: 'draft' }, NOW)).toBe(false);
    expect(isPublished({ status: 'review' }, NOW)).toBe(false);
    expect(isPublished({ status: 'archived' }, NOW)).toBe(false);
  });

  it('hides expired content even when published', () => {
    expect(isPublished({ status: 'published', expiresAt: PAST }, NOW)).toBe(false);
    // expiresAt exactly at now counts as expired (<=).
    expect(isPublished({ expiresAt: NOW.toISOString() }, NOW)).toBe(false);
  });
});

describe('staleContent', () => {
  const content: HelpContent = {
    pages: {
      Scout: {
        pageLabel: 'Scout',
        faq: [
          { id: 'scout.live', question: 'q', answer: 'a' }, // no meta → live
          { id: 'scout.draft', question: 'q', answer: 'a', meta: { status: 'draft', owner: 'cs' } },
          { id: 'scout.expired', question: 'q', answer: 'a', meta: { status: 'published', expiresAt: PAST } },
          { id: 'scout.review', question: 'q', answer: 'a', meta: { status: 'review' } },
        ],
      },
      Archived: { pageLabel: 'Old', faq: [], meta: { status: 'archived', owner: 'pm' } },
    },
    videos: {
      'v-live': { youtubeId: 'a', title: 't' },
      'v-expired': { youtubeId: 'b', title: 't', meta: { expiresAt: PAST } },
    },
  };

  it('lists only non-live nodes, with reason + owner', () => {
    const stale = staleContent(content, NOW);
    // Pages in insertion order (Scout before Archived); each page's entry + its
    // FAQs grouped together; then videos.
    expect(stale).toEqual([
      { kind: 'faq', pageKey: 'Scout', id: 'scout.draft', reason: 'draft', owner: 'cs' },
      { kind: 'faq', pageKey: 'Scout', id: 'scout.expired', reason: 'expired', owner: undefined },
      { kind: 'faq', pageKey: 'Scout', id: 'scout.review', reason: 'in_review', owner: undefined },
      { kind: 'page', id: 'Archived', reason: 'archived', owner: 'pm' },
      { kind: 'video', id: 'v-expired', reason: 'expired', owner: undefined },
    ]);
  });

  it('returns empty when everything is live', () => {
    const allLive: HelpContent = { pages: { P: { pageLabel: 'P', faq: [{ id: 'x', question: 'q', answer: 'a' }] } } };
    expect(staleContent(allLive, NOW)).toEqual([]);
  });
});
