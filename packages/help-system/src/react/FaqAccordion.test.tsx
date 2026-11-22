// @module-tag dom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FaqItem } from '../core/types';
import { FaqAccordion } from './FaqAccordion';

const faq = (id: string, question: string, over: Partial<FaqItem> = {}): FaqItem => ({
  id,
  question,
  answer: `Answer for ${question}`,
  ...over,
});

// Eight items so the default top-5 cap is observable.
const eightItems: FaqItem[] = [
  faq('a', 'How do I start a search?'),
  faq('b', 'What does the score mean?'),
  faq('c', 'Can I export contacts?'),
  faq('d', 'How do I draft an email?'),
  faq('e', 'What is delegation readiness?'),
  faq('f', 'How do I verify an email address?'),
  faq('g', 'Where are placements stored?'),
  faq('h', 'How do I change the LLM provider?'),
];

// queryAllByRole (not getAll) so the empty-state case can assert length 0 without throwing.
const headers = () => screen.queryAllByRole('button', { name: /\?$/ });

describe('FaqAccordion', () => {
  it('renders the curated top-N (default limit 5) as accordion header buttons', () => {
    render(<FaqAccordion items={eightItems} pageKey="Scout" />);
    expect(headers()).toHaveLength(5);
    // First five authored questions present; later ones are not in the default view.
    expect(screen.getByRole('button', { name: 'How do I start a search?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'How do I change the LLM provider?' })).not.toBeInTheDocument();
  });

  it('respects an explicit limit', () => {
    render(<FaqAccordion items={eightItems} pageKey="Scout" limit={3} />);
    expect(headers()).toHaveLength(3);
  });

  it('expands an item on click, revealing its answer and firing onOpenItem', async () => {
    const user = userEvent.setup();
    const onOpenItem = vi.fn();
    render(<FaqAccordion items={eightItems} pageKey="Scout" onOpenItem={onOpenItem} />);

    const header = screen.getByRole('button', { name: 'What does the score mean?' });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'What does the score mean?' })).not.toBeInTheDocument();

    await user.click(header);

    expect(header).toHaveAttribute('aria-expanded', 'true');
    const region = screen.getByRole('region', { name: 'What does the score mean?' });
    expect(region).toHaveTextContent('Answer for What does the score mean?');
    expect(onOpenItem).toHaveBeenCalledWith('b');
  });

  it('supports multiple panels open at once', async () => {
    const user = userEvent.setup();
    render(<FaqAccordion items={eightItems} pageKey="Scout" />);
    await user.click(screen.getByRole('button', { name: 'How do I start a search?' }));
    await user.click(screen.getByRole('button', { name: 'What does the score mean?' }));
    expect(screen.getByRole('region', { name: 'How do I start a search?' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'What does the score mean?' })).toBeInTheDocument();
  });

  it('fires onOpenItem only on expand, not on collapse', async () => {
    const user = userEvent.setup();
    const onOpenItem = vi.fn();
    render(<FaqAccordion items={eightItems} pageKey="Scout" onOpenItem={onOpenItem} />);
    const header = screen.getByRole('button', { name: 'How do I start a search?' });
    await user.click(header); // open
    await user.click(header); // close
    expect(onOpenItem).toHaveBeenCalledTimes(1);
  });

  it('narrows to matching items when typing in the search box', async () => {
    const user = userEvent.setup();
    render(<FaqAccordion items={eightItems} pageKey="Scout" />);
    // "provider" appears only in item h, which is *outside* the default top-5 —
    // proving search runs over the full gate-passing list, not just the top-N.
    await user.type(screen.getByRole('searchbox', { name: /search help/i }), 'provider');
    const results = headers();
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveTextContent('How do I change the LLM provider?');
  });

  it('shows an empty state when the search matches nothing', async () => {
    const user = userEvent.setup();
    render(<FaqAccordion items={eightItems} pageKey="Scout" />);
    await user.type(screen.getByRole('searchbox', { name: /search help/i }), 'zzqqxx-nomatch');
    expect(headers()).toHaveLength(0);
    expect(screen.getByText(/no matching help found/i)).toBeInTheDocument();
  });

  it('toggles the full gate-passing list with Browse all', async () => {
    const user = userEvent.setup();
    render(<FaqAccordion items={eightItems} pageKey="Scout" />);
    expect(headers()).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: /browse all/i }));
    expect(headers()).toHaveLength(8);
    await user.click(screen.getByRole('button', { name: /show fewer/i }));
    expect(headers()).toHaveLength(5);
  });

  it('renders a clickable video preview for items with a registered video and fires onWatchVideo', async () => {
    const user = userEvent.setup();
    const onWatchVideo = vi.fn();
    const items = [faq('vid', 'Got a video?', { videoId: 'scout-intro' }), faq('novid', 'No video here?')];
    const videos = { 'scout-intro': { youtubeId: 'dQw4w9WgXcQ', title: 'Scout intro' } };
    render(<FaqAccordion items={items} pageKey="Scout" videos={videos} onWatchVideo={onWatchVideo} />);

    await user.click(screen.getByRole('button', { name: 'Got a video?' }));
    const region = screen.getByRole('region', { name: 'Got a video?' });
    const preview = within(region).getByRole('button', { name: /play tutorial video/i });
    // The preview is the YouTube thumbnail for the resolved youtube id.
    expect(preview).toHaveAttribute('data-help-faq-video', 'dQw4w9WgXcQ');
    expect(preview.querySelector('img')?.getAttribute('src')).toContain('dQw4w9WgXcQ');
    await user.click(preview);
    expect(onWatchVideo).toHaveBeenCalledWith('scout-intro');

    // The video-less item exposes no preview.
    await user.click(screen.getByRole('button', { name: 'No video here?' }));
    expect(within(screen.getByRole('region', { name: 'No video here?' })).queryByRole('button')).toBeNull();
  });

  it('renders no preview when an item video is not in the registry', async () => {
    const user = userEvent.setup();
    const items = [faq('vid', 'Got a video?', { videoId: 'unknown' })];
    render(<FaqAccordion items={items} pageKey="Scout" videos={{}} />);
    await user.click(screen.getByRole('button', { name: 'Got a video?' }));
    expect(within(screen.getByRole('region', { name: 'Got a video?' })).queryByRole('button')).toBeNull();
  });

  it('never renders a hidden item', () => {
    const items = [faq('shown', 'Visible question?'), faq('secret', 'Hidden question?', { hidden: true })];
    render(<FaqAccordion items={items} pageKey="Scout" />);
    expect(screen.getByRole('button', { name: 'Visible question?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hidden question?' })).not.toBeInTheDocument();
  });
});
