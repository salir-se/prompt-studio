import { useCallback, useState } from 'react';
import type { VideoEntry } from '../core/types';

/**
 * A request to open a tutorial video in the floating PiP player. Mirrors the
 * shape {@link PipPlayer} consumes — either a bare `youtubeId` (the authored
 * {@link VideoEntry.youtubeId}) or a runtime-composed `src` URL, plus optional
 * `title`/`startSeconds`. The source is security-validated at render time.
 */
export interface PipVideoRequest {
  /** A YouTube URL (e.g. a runtime-localized source). Takes precedence over `youtubeId`. */
  src?: string;
  /** A bare 11-char YouTube video id (the authored base source). */
  youtubeId?: string;
  /** Header caption for the player. */
  title?: string;
  captionTrack?: VideoEntry['captionTrack'];
  /** Start offset in seconds. */
  startSeconds?: number;
}

export interface PipWindowController {
  /** The currently open video, or `null` when the player is closed. */
  video: PipVideoRequest | null;
  /** Open (or replace) the PiP video. Re-opening resets the minimized state. */
  openVideo: (video: PipVideoRequest) => void;
  /** Close the player and clear the active video. */
  close: () => void;
  /** Whether the open player is minimized (collapsed to its header). */
  minimized: boolean;
  /** Toggle the minimized state of the open player. */
  toggleMinimize: () => void;
}

/**
 * Owns which tutorial video is open in the floating {@link PipPlayer} and its
 * minimized state. The browser-dispatch bridge calls `openVideo` (from the LLM's
 * `show_tutorial` / `compose_tutorial_link` tools); the user closes or minimizes
 * it. Read-only by design — opening a video never mutates host app state.
 */
export function usePipWindow(): PipWindowController {
  const [video, setVideo] = useState<PipVideoRequest | null>(null);
  const [minimized, setMinimized] = useState(false);

  const openVideo = useCallback((next: PipVideoRequest) => {
    // A fresh request always opens expanded — a previously minimized player
    // should not swallow a newly requested video.
    setMinimized(false);
    setVideo(next);
  }, []);

  const close = useCallback(() => {
    setVideo(null);
    setMinimized(false);
  }, []);

  const toggleMinimize = useCallback(() => setMinimized((m) => !m), []);

  return { video, openVideo, close, minimized, toggleMinimize };
}
