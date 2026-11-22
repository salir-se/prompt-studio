import { useEffect, useRef } from 'react';
import { Rnd } from 'react-rnd';
import { detectPipEmbedMode, type PipEmbedMode } from '../core/pip-embed-mode';
import type { VideoEntry } from '../core/types';
import { validateVideoSrc } from '../core/validateVideoSrc';
import { normalizeVideoLanguage } from '../core/video-language';
import { clampPipGeometry } from './pip-geometry';
import { connectYouTubeCaptions } from './youtube-captions';

// SECURITY — TRUSTED COMPONENT (ADR-089).
//
// This component renders a real YouTube embed as a plain <iframe> that
// PipPlayer itself owns (not a wrapper library's element), NOT user-authored
// HTML. It must therefore NEVER be routed through an HTML
// sanitizer/`dangerouslySetInnerHTML` pipeline — doing so would corrupt the
// iframe markup. The only untrusted input is the video *source string* (which
// the LLM may compose at runtime via `compose_tutorial_link`); that single
// value is gated through `validateVideoSrc`, which reduces it to a known-safe
// `youtube-nocookie` video id before any iframe is created. If validation
// fails, no embed renders. The iframe carries the `credentialless` attribute
// so it keeps rendering under `app.salir.*`'s `Cross-Origin-Embedder-Policy:
// credentialless` (ADR-275 D11) — a cross-origin iframe without that
// attribute would otherwise be blocked outright by COEP.

export interface PipPlayerProps {
  /** A bare 11-char YouTube video id (the authored base source). */
  youtubeId?: string;
  /** A YouTube URL (e.g. a runtime-localized source). Takes precedence over `youtubeId`. */
  src?: string;
  /** Header caption; also the dialog's accessible name. */
  title?: string;
  /** Preferred player/caption language; a validated source language overrides it. */
  locale?: string;
  captionTrack?: VideoEntry['captionTrack'];
  /** Start offset in seconds (overridden by a `t=`/`start=` in `src`, if present). */
  startSeconds?: number;
  /** Called when the user closes the player. */
  onClose: () => void;
  /** Called when the user minimizes the player. When omitted, no minimize button renders. */
  onMinimize?: () => void;
  /**
   * Resolves whether to embed the iframe or render the link-out fallback.
   * Defaults to `detectPipEmbedMode` (reads `window.crossOriginIsolated` +
   * `credentialless` iframe support); overridable so stories/tests can force
   * either branch without faking browser globals.
   */
  detectEmbedMode?: () => PipEmbedMode;
}

// `credentialless` is a real HTML iframe boolean attribute (part of the same
// COEP: credentialless spec that ships the header this component's iframe
// depends on). React 19 treats it as a boolean attribute: `true` renders
// `credentialless=""`, while an empty string is falsy and drops the attribute,
// which would let COEP block the embed. This cast only teaches TypeScript about
// that one extra prop, scoped to this spread, so JSX excess-property checks on
// the rest of the iframe's typed props stay in force (unlike a cast to the full
// `IframeHTMLAttributes`, which would additionally weaken checking of every
// other prop on the tag).
const CREDENTIALLESS_IFRAME_ATTR = { credentialless: true } as unknown as { credentialless: boolean };

// Just under the max 32-bit signed int so the player floats above app chrome
// (and the help spotlight overlay at 2147483000) but below nothing it shouldn't.
const PIP_Z_INDEX = 2147483600;

// react-rnd drags only from elements carrying this class (see `dragHandleClassName`).
const DRAG_HANDLE_CLASS = 'pip-drag-handle';

// Desired (desktop) size and the floors react-rnd is allowed to shrink to.
// `clampPipGeometry` (issue #860) fits these into the actual viewport at
// mount so the player — and its close button — never starts off-screen on a
// phone; on a desktop-sized viewport it reproduces this geometry exactly.
const DESIRED_WIDTH = 400;
const DESIRED_HEIGHT = 250;
const VIEWPORT_MARGIN = 32;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 180;

/**
 * A draggable, resizable, in-app floating YouTube player ("picture-in-picture")
 * for tutorial videos (ADR-089). Read-only: it only displays a video and never
 * mutates host app state. The source is security-validated before any iframe is
 * rendered; an invalid source yields an inline `role="alert"` notice instead.
 */
export function PipPlayer({
  youtubeId,
  src,
  title,
  locale,
  captionTrack,
  startSeconds,
  onClose,
  onMinimize,
  detectEmbedMode = detectPipEmbedMode,
}: PipPlayerProps) {
  // Resolve the source (URL beats bare id) and validate it BEFORE rendering any
  // embed. `validateVideoSrc` only knows about the source string, so fold the
  // caller-supplied `startSeconds` in as a fallback when the source carries none.
  const result = validateVideoSrc(src ?? youtubeId ?? '');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const captionLocale = result.ok
    ? (new URL(result.video.embedUrl).searchParams.get('cc_lang_pref') ?? locale)
    : undefined;
  useEffect(() => {
    if (!iframeRef.current || !captionTrack || !captionLocale) return;
    return connectYouTubeCaptions(iframeRef.current, captionTrack, captionLocale);
  }, [src, youtubeId, captionTrack, captionLocale]);
  const accessibleName = title ?? 'Tutorial video';

  if (!result.ok) {
    // SECURITY GATE: a rejected source renders an inline error and NEVER an
    // iframe/YouTube embed. Kept non-draggable/minimal — there is nothing to play.
    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          zIndex: PIP_Z_INDEX,
          maxWidth: 320,
          padding: '10px 12px',
          borderRadius: 8,
          background: 'var(--popover, #111)',
          color: 'var(--popover-foreground, #fff)',
          border: '1px solid var(--border, rgba(255,255,255,0.15))',
          font: '13px/1.4 system-ui, sans-serif',
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ flex: 1 }}>This tutorial video could not be loaded.</span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            flexShrink: 0,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            font: 'inherit',
            lineHeight: 1,
            padding: 0,
          }}
        >
          {'×'}
        </button>
      </div>
    );
  }

  const startAt = result.video.startSeconds ?? startSeconds ?? 0;
  const embedMode = detectEmbedMode();
  const embedUrl = new URL(result.video.embedUrl);
  const language = normalizeVideoLanguage(locale);
  if (language) {
    if (!embedUrl.searchParams.has('hl')) embedUrl.searchParams.set('hl', language);
    if (!embedUrl.searchParams.has('cc_lang_pref')) embedUrl.searchParams.set('cc_lang_pref', language);
    embedUrl.searchParams.set('cc_load_policy', '1');
  }
  if (captionTrack && captionLocale && typeof window !== 'undefined') {
    embedUrl.searchParams.set('enablejsapi', '1');
    embedUrl.searchParams.set('origin', window.location.origin);
  }
  embedUrl.searchParams.set('autoplay', '1');
  embedUrl.searchParams.set('rel', '0');
  embedUrl.searchParams.set('playsinline', '1');
  if (startAt) embedUrl.searchParams.set('start', String(startAt));
  const watchUrl = new URL(`https://www.youtube.com/watch?v=${result.video.videoId}${startAt ? `&t=${startAt}s` : ''}`);
  for (const key of ['hl', 'cc_lang_pref', 'cc_load_policy']) {
    const value = embedUrl.searchParams.get(key);
    if (value) watchUrl.searchParams.set(key, value);
  }

  // SSR-safe: fall back to a desktop-sized viewport when `window` is unavailable
  // (matches the `useIsMobile` convention elsewhere in this package). In a real
  // browser this reads the actual viewport at mount, so a phone gets a fully
  // on-screen player instead of the old fixed desktop geometry.
  const viewport =
    typeof window === 'undefined'
      ? { width: DESIRED_WIDTH + VIEWPORT_MARGIN * 2, height: DESIRED_HEIGHT + VIEWPORT_MARGIN * 2 }
      : { width: window.innerWidth, height: window.innerHeight };
  const geometry = clampPipGeometry(viewport, {
    width: DESIRED_WIDTH,
    height: DESIRED_HEIGHT + (captionLocale ? 64 : 0),
    margin: VIEWPORT_MARGIN,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
  });

  return (
    <Rnd
      default={geometry}
      minWidth={MIN_WIDTH}
      minHeight={MIN_HEIGHT}
      bounds="window"
      dragHandleClassName={DRAG_HANDLE_CLASS}
      style={{ zIndex: PIP_Z_INDEX }}
    >
      {/* Card-like container. role="dialog" + aria-label give the floating player an accessible name. */}
      <section
        data-help-pip
        role="dialog"
        aria-label={accessibleName}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          borderRadius: 10,
          background: 'var(--popover, #111)',
          color: 'var(--popover-foreground, #fff)',
          border: '1px solid var(--border, rgba(255,255,255,0.15))',
          boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
          font: '13px/1.4 system-ui, sans-serif',
        }}
      >
        {/* Header doubles as the drag handle (the only draggable region). */}
        <header
          className={DRAG_HANDLE_CLASS}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px',
            cursor: 'move',
            background: 'var(--muted, rgba(255,255,255,0.06))',
            borderBottom: '1px solid var(--border, rgba(255,255,255,0.12))',
            userSelect: 'none',
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: 600,
            }}
          >
            {accessibleName}
          </span>
          {onMinimize ? (
            <button type="button" aria-label="Minimize" onClick={onMinimize} style={iconButtonStyle}>
              {'–'}
            </button>
          ) : null}
          <button type="button" aria-label="Close" onClick={onClose} style={iconButtonStyle}>
            {'×'}
          </button>
        </header>

        {/* Body — either the validated YouTube embed or the link-out fallback fills the remaining space. */}
        <div style={{ flex: 1, minHeight: 0, background: '#000' }}>
          {embedMode === 'embed' ? (
            <iframe
              ref={iframeRef}
              // Built from the validated `result.video.videoId` only — never from the raw
              // caller-supplied `src`/`youtubeId` — so an unvalidated string can never
              // reach the iframe. Computed only here, not on the link-out branch.
              src={embedUrl.toString()}
              className="pip-youtube-iframe"
              title={accessibleName}
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              // Required for the embed to keep rendering under this app's
              // `Cross-Origin-Embedder-Policy: credentialless` (ADR-275 D11) — a
              // cross-origin iframe without it is blocked outright by COEP.
              {...CREDENTIALLESS_IFRAME_ATTR}
            />
          ) : (
            // Always rendered on the fixed `#000` video pane above (not the
            // theme-following popover surface), so colors are hardcoded light
            // rather than the `--popover-foreground`/`--border` theme vars —
            // those resolve dark in a light theme and were unreadable here.
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                padding: 16,
                textAlign: 'center',
                color: '#fff',
              }}
            >
              <span style={{ flex: '0 0 auto' }}>This browser can't play the video here.</span>
              <a
                href={watchUrl.toString()}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flexShrink: 0,
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.4)',
                  color: '#fff',
                  textDecoration: 'none',
                  font: 'inherit',
                  fontWeight: 600,
                }}
              >
                Open on YouTube
              </a>
            </div>
          )}
        </div>
        {embedUrl.searchParams.has('cc_lang_pref') ? (
          <details style={{ padding: '6px 8px', fontSize: 12, flexShrink: 0 }}>
            <summary style={{ cursor: 'pointer' }}>Change subtitle language</summary>
            In the video, choose Settings → Subtitles/CC → Auto-translate.
          </details>
        ) : null}
      </section>
    </Rnd>
  );
}

// Shared style for the header's icon buttons (minimize / close).
const iconButtonStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 24,
  height: 24,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: '16px/1 system-ui, sans-serif',
  padding: 0,
};
