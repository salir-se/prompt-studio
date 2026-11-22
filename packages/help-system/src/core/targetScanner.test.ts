// @module-tag dom
import { describe, expect, it } from 'vitest';
import { collectDomHelpIdCounts, scanHelpTargets } from './targetScanner';
import type { HelpTourStep } from './tour';
import type { HelpContent } from './types';

const content: HelpContent = {
  pages: {
    Scout: {
      pageLabel: 'Scout',
      highlightables: [
        { helpId: 'scout.run', label: 'Run', description: 'd' },
        { helpId: 'scout.gone', label: 'Gone', description: 'd' },
        { helpId: 'scout.dup', label: 'Dup', description: 'd' },
      ],
      faq: [
        { id: 'scout.a', question: 'q', answer: 'a', videoId: 'known' },
        { id: 'scout.b', question: 'q', answer: 'a', videoId: 'missing-video' },
      ],
    },
  },
  videos: { known: { youtubeId: 'x', title: 't' } },
};

const tours: Record<string, HelpTourStep[]> = {
  Scout: [
    { targetHelpId: 'scout.run', body: 'ok' },
    { targetHelpId: 'tour.gone', body: 'x' },
  ],
};

// scout.run present once, scout.dup twice, others absent.
const counts = new Map<string, number>([
  ['scout.run', 1],
  ['scout.dup', 2],
]);

describe('scanHelpTargets', () => {
  it('flags missing targets, duplicates, and missing videos', () => {
    const issues = scanHelpTargets({ content, tours, domHelpIdCounts: counts });
    const kinds = issues.map((i) => `${i.kind}:${i.helpId ?? i.videoId}`);
    expect(kinds).toContain('missing_target:scout.gone');
    expect(kinds).toContain('duplicate_target:scout.dup');
    expect(kinds).toContain('missing_video:missing-video');
    expect(kinds).toContain('missing_target:tour.gone');
    // scout.run resolves cleanly → no issue for it.
    expect(kinds).not.toContain('missing_target:scout.run');
  });

  it('returns no issues for a fully-resolved page', () => {
    const clean: HelpContent = {
      pages: { P: { pageLabel: 'P', highlightables: [{ helpId: 'ok', label: 'L', description: 'd' }], faq: [] } },
    };
    expect(scanHelpTargets({ content: clean, domHelpIdCounts: new Map([['ok', 1]]) })).toEqual([]);
  });

  it('scopes to a single page when pageKey is given', () => {
    const multi: HelpContent = {
      pages: {
        A: { pageLabel: 'A', highlightables: [{ helpId: 'a.x', label: 'L', description: 'd' }], faq: [] },
        B: { pageLabel: 'B', highlightables: [{ helpId: 'b.x', label: 'L', description: 'd' }], faq: [] },
      },
    };
    // Only A mounted; scanning scoped to A reports nothing, but unscoped flags b.x.
    const dom = new Map([['a.x', 1]]);
    expect(scanHelpTargets({ content: multi, domHelpIdCounts: dom, pageKey: 'A' })).toEqual([]);
    expect(scanHelpTargets({ content: multi, domHelpIdCounts: dom }).map((i) => i.helpId)).toEqual(['b.x']);
  });

  it('accepts a lookup function for counts', () => {
    const issues = scanHelpTargets({
      content,
      domHelpIdCounts: (id) => (id === 'scout.run' ? 1 : 0),
      pageKey: 'Scout',
    });
    expect(issues.some((i) => i.kind === 'missing_target' && i.helpId === 'scout.gone')).toBe(true);
  });
});

describe('collectDomHelpIdCounts', () => {
  it('counts data-help-id occurrences in a DOM root', () => {
    document.body.innerHTML =
      '<button data-help-id="a">1</button><div data-help-id="a">2</div><span data-help-id="b">3</span>';
    const counts = collectDomHelpIdCounts(document);
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    expect(counts.get('c')).toBeUndefined();
  });
});
