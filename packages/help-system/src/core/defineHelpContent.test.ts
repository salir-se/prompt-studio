// @module-tag dom
import { describe, expect, it } from 'vitest';
import { defineHelpContent } from './defineHelpContent';
import type { HelpContent } from './types';

describe('defineHelpContent', () => {
  it('accepts and returns a valid English content registry', () => {
    const content = defineHelpContent({
      pages: {
        Scout: {
          pageLabel: 'Scout',
          faq: [
            {
              id: 'scout.what',
              question: 'How do I start a search?',
              answer: 'Click Run Scout.',
              videoId: 'scout-intro',
              pinned: true,
            },
          ],
          highlightables: [{ helpId: 'scout.run-button', label: 'Run Scout', description: 'Starts a search.' }],
          aiContext: { systemPromptAppendix: 'Scout finds companies.', materials: [{ title: 'ICP', body: '...' }] },
        },
      },
      videos: { 'scout-intro': { youtubeId: 'abc123', title: 'Scout intro' } },
    });

    expect(content.pages.Scout.faq[0].id).toBe('scout.what');
    expect(content.videos?.['scout-intro'].youtubeId).toBe('abc123');
  });

  it('throws a clear error when an FAQ item is missing its answer', () => {
    const bad = {
      pages: { Scout: { pageLabel: 'Scout', faq: [{ id: 'x', question: 'q' }] } },
    } as unknown as HelpContent;

    expect(() => defineHelpContent(bad)).toThrow(/Invalid help content/);
  });

  it('rejects a non-string youtubeId', () => {
    const bad = {
      pages: { Scout: { pageLabel: 'Scout', faq: [] } },
      videos: { v: { youtubeId: 123, title: 'x' } },
    } as unknown as HelpContent;

    expect(() => defineHelpContent(bad)).toThrow(/Invalid help content/);
  });

  it('accepts an empty FAQ list for a page', () => {
    expect(() => defineHelpContent({ pages: { Dashboard: { pageLabel: 'Dashboard', faq: [] } } })).not.toThrow();
  });
});

it('rejects malformed authored caption metadata', () => {
  const bad = {
    pages: {},
    videos: { intro: { youtubeId: 'PVvOu7YhQrs', title: 'Overview', captionTrack: { languageCode: 4 } } },
  } as unknown as HelpContent;
  expect(() => defineHelpContent(bad)).toThrow(/Invalid help content/);
});
