import { validateVideoSrc } from '../core/validateVideoSrc';

export interface FaqVideoPreviewProps {
  /** YouTube id (or URL) for the video — taken from the host's VideoRegistry. */
  youtubeId: string;
  /** Video title, used for the accessible label + caption overlay. */
  title?: string;
  /** Called when the user clicks the preview to play it (the host opens the PiP). */
  onPlay?: () => void;
}

/**
 * A clickable video **preview** shown inside an FAQ answer panel for items that
 * have a tutorial video: the YouTube thumbnail with a play badge. Clicking it
 * signals intent via `onPlay` — the host opens the floating PiP player (ADR-089).
 * Read-only.
 *
 * The thumbnail URL is built only from a **validated** 11-char YouTube id
 * (`validateVideoSrc`), so a malformed id renders nothing rather than a broken or
 * unsafe image. No `@prompt-studio/ui` / Radix / lucide — plain HTML + theme CSS vars.
 */
export function FaqVideoPreview({ youtubeId, title, onPlay }: FaqVideoPreviewProps) {
  const result = validateVideoSrc(youtubeId);
  if (!result.ok) return null;

  const thumbnail = `https://img.youtube.com/vi/${result.video.videoId}/hqdefault.jpg`;

  return (
    <button
      type="button"
      data-help-faq-video={result.video.videoId}
      onClick={() => onPlay?.()}
      aria-label={title ? `Play tutorial video: ${title}` : 'Play tutorial video'}
      style={{
        display: 'block',
        position: 'relative',
        width: 240,
        maxWidth: '100%',
        marginTop: 8,
        padding: 0,
        border: '1px solid var(--border, #d4d4d8)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--muted, #000)',
        cursor: 'pointer',
        lineHeight: 0,
      }}
    >
      <img
        src={thumbnail}
        alt=""
        loading="lazy"
        width={240}
        height={135}
        style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: '16 / 9', objectFit: 'cover' }}
      />
      <span
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 48,
            height: 48,
            paddingLeft: 4,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.65)',
            color: '#fff',
            font: '20px/1 system-ui, sans-serif',
          }}
        >
          ▶
        </span>
      </span>
      {title ? (
        <span
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '12px 8px 6px',
            background: 'linear-gradient(transparent, rgba(0,0,0,0.72))',
            color: '#fff',
            font: '12px/1.3 system-ui, sans-serif',
            textAlign: 'left',
          }}
        >
          {title}
        </span>
      ) : null}
    </button>
  );
}
