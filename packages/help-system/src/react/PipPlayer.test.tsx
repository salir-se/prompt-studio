// @module-tag dom
import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PipPlayer } from './PipPlayer';
import { usePipWindow } from './usePipWindow';

// react-rnd becomes a passthrough wrapper so it renders trivially under
// happy-dom. PipPlayer owns its <iframe> directly (no react-youtube) so the
// embed itself needs no mock — we assert on the real DOM element.
vi.mock('react-rnd', () => ({ Rnd: (p: any) => <div data-rnd>{p.children}</div> }));

// NB: no manual `document.body.innerHTML = ''` here — Testing-Library's
// auto-cleanup unmounts between tests; wiping the body would race that.

const VIDEO_ID = 'dQw4w9WgXcQ'; // valid 11-char YouTube id
const embedMode = () => 'embed' as const;
const linkOutMode = () => 'link-out' as const;

describe('PipPlayer', () => {
  it('renders the YouTube embed iframe for a valid id and no error', () => {
    render(<PipPlayer youtubeId={VIDEO_ID} title="Scout intro" onClose={() => {}} detectEmbedMode={embedMode} />);

    const iframe = screen.getByTitle('Scout intro');
    expect(iframe).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('builds the privacy-enhanced nocookie embed src with autoplay/rel/playsinline (ADR-089)', () => {
    render(<PipPlayer youtubeId={VIDEO_ID} title="Scout intro" onClose={() => {}} detectEmbedMode={embedMode} />);

    const src = screen.getByTitle('Scout intro').getAttribute('src') ?? '';
    expect(src.startsWith(`https://www.youtube-nocookie.com/embed/${VIDEO_ID}`)).toBe(true);
    expect(src).toContain('autoplay=1');
    expect(src).toContain('rel=0');
    expect(src).toContain('playsinline=1');
    expect(src).not.toContain('start=');
  });

  it('includes start= in the embed src when a start offset is provided', () => {
    render(
      <PipPlayer
        youtubeId={VIDEO_ID}
        title="Scout intro"
        startSeconds={42}
        onClose={() => {}}
        detectEmbedMode={embedMode}
      />,
    );

    expect(screen.getByTitle('Scout intro').getAttribute('src')).toContain('start=42');
  });

  it('carries the credentialless attribute (required under COEP: credentialless, ADR-275 D11)', () => {
    render(<PipPlayer youtubeId={VIDEO_ID} title="Scout intro" onClose={() => {}} detectEmbedMode={embedMode} />);

    expect(screen.getByTitle('Scout intro')).toHaveAttribute('credentialless');
  });

  it('sets the iframe title to the accessible name and an allow list including autoplay', () => {
    render(<PipPlayer youtubeId={VIDEO_ID} title="Scout intro" onClose={() => {}} detectEmbedMode={embedMode} />);

    const iframe = screen.getByTitle('Scout intro');
    expect(iframe).toHaveAttribute('title', 'Scout intro');
    expect(iframe.getAttribute('allow')).toContain('autoplay');
  });

  it('gates an untrusted source: shows an alert and renders no embed (embed mode)', () => {
    render(<PipPlayer src="https://evil.com/x" title="Bad" onClose={() => {}} detectEmbedMode={embedMode} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTitle('Bad')).not.toBeInTheDocument();
  });

  it('gates an untrusted source: shows an alert and renders no embed (link-out mode)', () => {
    render(<PipPlayer src="https://evil.com/x" title="Bad" onClose={() => {}} detectEmbedMode={linkOutMode} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTitle('Bad')).not.toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PipPlayer youtubeId={VIDEO_ID} title="Scout intro" onClose={onClose} detectEmbedMode={embedMode} />);

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders a minimize button that calls onMinimize when provided', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onMinimize = vi.fn();
    render(
      <PipPlayer
        youtubeId={VIDEO_ID}
        title="Scout intro"
        onClose={() => {}}
        onMinimize={onMinimize}
        detectEmbedMode={embedMode}
      />,
    );

    await user.click(screen.getByRole('button', { name: /minimize/i }));
    expect(onMinimize).toHaveBeenCalledTimes(1);
  });

  it('omits the minimize button when onMinimize is not provided', () => {
    render(<PipPlayer youtubeId={VIDEO_ID} title="Scout intro" onClose={() => {}} detectEmbedMode={embedMode} />);
    expect(screen.queryByRole('button', { name: /minimize/i })).not.toBeInTheDocument();
  });

  describe('link-out fallback (isolated document, no credentialless iframe support)', () => {
    it('renders no iframe and an "Open on YouTube" link instead', () => {
      render(<PipPlayer youtubeId={VIDEO_ID} title="Scout intro" onClose={() => {}} detectEmbedMode={linkOutMode} />);

      expect(screen.queryByTitle('Scout intro')).not.toBeInTheDocument();
      const link = screen.getByRole('link', { name: /open on youtube/i });
      expect(link).toHaveAttribute('href', `https://www.youtube.com/watch?v=${VIDEO_ID}`);
    });

    it('opens the link in a new tab without leaking a referrer/opener', () => {
      render(<PipPlayer youtubeId={VIDEO_ID} title="Scout intro" onClose={() => {}} detectEmbedMode={linkOutMode} />);

      const link = screen.getByRole('link', { name: /open on youtube/i });
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    });

    it('includes a start offset (t=<n>s) in the watch URL when provided', () => {
      render(
        <PipPlayer
          youtubeId={VIDEO_ID}
          title="Scout intro"
          startSeconds={42}
          onClose={() => {}}
          detectEmbedMode={linkOutMode}
        />,
      );

      expect(screen.getByRole('link', { name: /open on youtube/i })).toHaveAttribute(
        'href',
        `https://www.youtube.com/watch?v=${VIDEO_ID}&t=42s`,
      );
    });

    it('still shows the close button so the player can be dismissed', async () => {
      const { default: userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<PipPlayer youtubeId={VIDEO_ID} title="Scout intro" onClose={onClose} detectEmbedMode={linkOutMode} />);

      await user.click(screen.getByRole('button', { name: /close/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});

describe('usePipWindow', () => {
  it('opens, closes, and toggles minimize', () => {
    const { result } = renderHook(() => usePipWindow());
    expect(result.current.video).toBeNull();
    expect(result.current.minimized).toBe(false);

    act(() => result.current.openVideo({ youtubeId: VIDEO_ID, title: 'Scout intro' }));
    expect(result.current.video?.youtubeId).toBe(VIDEO_ID);

    act(() => result.current.toggleMinimize());
    expect(result.current.minimized).toBe(true);

    act(() => result.current.close());
    expect(result.current.video).toBeNull();
    expect(result.current.minimized).toBe(false);
  });

  it('re-opening resets a minimized player back to expanded', () => {
    const { result } = renderHook(() => usePipWindow());

    act(() => result.current.openVideo({ youtubeId: VIDEO_ID }));
    act(() => result.current.toggleMinimize());
    expect(result.current.minimized).toBe(true);

    act(() => result.current.openVideo({ youtubeId: 'abcdefghijk' }));
    expect(result.current.minimized).toBe(false);
    expect(result.current.video?.youtubeId).toBe('abcdefghijk');
  });
});

describe('PipPlayer language preferences', () => {
  it.each(['sv-SE', 'de-DE', 'en-US'])('requests captions for browser locale %s from a bare tutorial id', (locale) => {
    render(<PipPlayer youtubeId={VIDEO_ID} locale={locale} onClose={() => {}} detectEmbedMode={embedMode} />);
    const url = new URL(screen.getByTitle('Tutorial video').getAttribute('src')!);
    expect(url.searchParams.get('hl')).toBe(locale);
    expect(url.searchParams.get('cc_lang_pref')).toBe(locale);
    expect(url.searchParams.get('cc_load_policy')).toBe('1');
  });

  it('keeps a composed caption choice over the browser language', () => {
    render(
      <PipPlayer
        src={`https://youtu.be/${VIDEO_ID}?hl=de&cc_lang_pref=de&cc_load_policy=1`}
        locale="sv-SE"
        onClose={() => {}}
        detectEmbedMode={embedMode}
      />,
    );
    const url = new URL(screen.getByTitle('Tutorial video').getAttribute('src')!);
    expect(url.searchParams.get('cc_lang_pref')).toBe('de');
  });

  it('retains subtitle language in the link-out fallback and explains manual translation', () => {
    render(<PipPlayer youtubeId={VIDEO_ID} locale="sv-SE" onClose={() => {}} detectEmbedMode={linkOutMode} />);
    const url = new URL(screen.getByRole('link', { name: /open on youtube/i }).getAttribute('href')!);
    expect(url.searchParams.get('cc_lang_pref')).toBe('sv-SE');
    expect(screen.getByText(/Auto-translate/)).toBeInTheDocument();
  });
});
