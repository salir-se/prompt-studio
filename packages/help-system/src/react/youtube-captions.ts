import type { VideoEntry } from '../core/types';
import { normalizeVideoLanguage } from '../core/video-language';

const YOUTUBE_ORIGIN = 'https://www.youtube-nocookie.com';

/** Connect only to our validated iframe, never page-authored messages or arbitrary origins. */
export function connectYouTubeCaptions(
  frame: HTMLIFrameElement,
  captionTrack: NonNullable<VideoEntry['captionTrack']>,
  locale: string,
): () => void {
  const sourceLanguage = normalizeVideoLanguage(captionTrack.languageCode);
  const targetLanguage = normalizeVideoLanguage(locale)?.split('-')[0];
  if (!sourceLanguage || !targetLanguage) return () => {};
  const send = (func: string, args: unknown[]) => {
    frame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), YOUTUBE_ORIGIN);
  };
  let applied = false;
  const listen = () => {
    applied = false;
    frame.contentWindow?.postMessage(JSON.stringify({ event: 'listening' }), YOUTUBE_ORIGIN);
    send('addEventListener', ['onReady']);
    send('addEventListener', ['onStateChange']);
  };
  const receive = (event: MessageEvent) => {
    if (event.origin !== YOUTUBE_ORIGIN || event.source !== frame.contentWindow || typeof event.data !== 'string')
      return;
    let message: { event?: string; info?: unknown } | null;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message?.event === 'onReady') send('loadModule', ['captions']);
    if (message?.event !== 'onStateChange' || message.info !== 1 || applied) return;
    applied = true;
    // shortcut: YouTube's translated-track option is undocumented; keep the visible Auto-translate fallback until authored translated captions exist.
    send('setOption', [
      'captions',
      'track',
      {
        ...captionTrack,
        ...(sourceLanguage.split('-')[0] !== targetLanguage
          ? {
              translationLanguage: {
                languageCode: targetLanguage,
                languageName: new Intl.DisplayNames([targetLanguage], { type: 'language' }).of(targetLanguage),
              },
            }
          : {}),
      },
    ]);
  };
  frame.addEventListener('load', listen);
  window.addEventListener('message', receive);
  listen();
  return () => {
    frame.removeEventListener('load', listen);
    window.removeEventListener('message', receive);
  };
}
