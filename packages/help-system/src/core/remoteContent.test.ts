// @module-tag dom
// Merge + validation contract for CMS-managed help content (ADR-095).
// Pins the semantics the SPAs rely on: remote-wins-by-id, additive,
// unmanaged bundled fields survive, malformed payloads reject wholesale.

import { describe, expect, it } from 'vitest';
import { mergeHelpContent, parseRemoteHelpPayload } from './remoteContent';
import type { HelpContent } from './types';

const base: HelpContent = {
  pages: {
    Scout: {
      pageLabel: 'Scout',
      faq: [
        { id: 'scout.what', question: 'What is Scout?', answer: 'Bundled answer.', videoId: 'scout', flag: 'beta' },
        { id: 'scout.score', question: 'How is scoring done?', answer: '0-100.' },
      ],
      highlightables: [{ helpId: 'scout.run', label: 'Run', description: 'Runs the agent' }],
      aiContext: { systemPromptAppendix: 'Scout context' },
    },
  },
  videos: { scout: { youtubeId: 'abc123', title: 'Scout tour' } },
};

function payload(pages: Record<string, { pageLabel: string; faq: unknown[] }>) {
  return parseRemoteHelpPayload({ surface: 'app', generatedAt: '2026-06-10T00:00:00Z', pages });
}

describe('parseRemoteHelpPayload', () => {
  it('accepts a valid payload and ignores unknown extra fields (expand-only)', () => {
    const parsed = parseRemoteHelpPayload({
      surface: 'app',
      generatedAt: 'now',
      futureField: { anything: true },
      pages: { Scout: { pageLabel: 'Scout', faq: [{ id: 'a', question: 'Q', answer: 'A', futureFaqField: 1 }] } },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.pages.Scout.faq[0].id).toBe('a');
  });

  it('rejects the whole payload on any shape violation', () => {
    expect(parseRemoteHelpPayload(null)).toBeNull();
    expect(parseRemoteHelpPayload('html error page')).toBeNull();
    expect(parseRemoteHelpPayload({ surface: 'app' })).toBeNull();
    expect(
      parseRemoteHelpPayload({
        surface: 'app',
        pages: { Scout: { pageLabel: 'Scout', faq: [{ id: 'a', question: 42, answer: 'A' }] } },
      }),
    ).toBeNull();
  });
});

describe('mergeHelpContent', () => {
  it('remote item with a bundled id overrides CMS-managed fields but keeps videoId/flag gating', () => {
    const remote = payload({
      Scout: {
        pageLabel: 'Scout',
        faq: [{ id: 'scout.what', question: 'What is Scout really?', answer: 'CMS answer.', pinned: true, version: 4 }],
      },
    });
    const merged = mergeHelpContent(base, remote as NonNullable<typeof remote>);
    const item = merged.pages.Scout.faq.find((f) => f.id === 'scout.what');
    expect(item).toMatchObject({
      question: 'What is Scout really?',
      answer: 'CMS answer.',
      pinned: true,
      videoId: 'scout', // unmanaged bundled fields survive the override
      flag: 'beta',
      meta: { version: 4 },
    });
    // Untouched bundled sibling stays as-is.
    expect(merged.pages.Scout.faq.find((f) => f.id === 'scout.score')?.answer).toBe('0-100.');
  });

  it('appends remote-only items and adds remote-only pages', () => {
    const remote = payload({
      Scout: { pageLabel: 'Scout', faq: [{ id: 'scout.new', question: 'New Q', answer: 'New A' }] },
      Booking: { pageLabel: 'Booking', faq: [{ id: 'booking.what', question: 'B?', answer: 'B.' }] },
    });
    const merged = mergeHelpContent(base, remote as NonNullable<typeof remote>);
    expect(merged.pages.Scout.faq.map((f) => f.id)).toEqual(['scout.what', 'scout.score', 'scout.new']);
    expect(merged.pages.Booking).toMatchObject({ pageLabel: 'Booking' });
    expect(merged.pages.Booking.faq[0].id).toBe('booking.what');
  });

  it('keeps videos, highlightables, and aiContext from the bundle and never mutates inputs', () => {
    const remote = payload({ Scout: { pageLabel: 'Scout', faq: [{ id: 'x', question: 'Q', answer: 'A' }] } });
    const merged = mergeHelpContent(base, remote as NonNullable<typeof remote>);
    expect(merged.videos).toBe(base.videos);
    expect(merged.pages.Scout.highlightables).toBe(base.pages.Scout.highlightables);
    expect(merged.pages.Scout.aiContext).toBe(base.pages.Scout.aiContext);
    expect(base.pages.Scout.faq).toHaveLength(2); // input untouched
  });

  it('an empty remote page map returns the bundled pages by reference', () => {
    const remote = payload({});
    const merged = mergeHelpContent(base, remote as NonNullable<typeof remote>);
    expect(merged.pages.Scout).toBe(base.pages.Scout);
  });
});
