import { normalizeVideoLanguage } from './video-language';

// Security boundary for tutorial videos (ADR-089).
//
// A localized video source can be composed at runtime by the LLM (the
// `compose_tutorial_link` MCP tool). That source ultimately feeds an <iframe>,
// so it MUST be validated against a YouTube host allowlist and reduced to a
// known-safe embed URL before it is ever rendered. The assistant never gets to
// put an arbitrary URL on screen.

export interface ValidatedVideo {
  /** The 11-char YouTube video id. */
  videoId: string;
  /** Optional start offset in seconds. */
  startSeconds?: number;
  /** Privacy-enhanced embed URL safe to place in an iframe `src`. */
  embedUrl: string;
}

export type ValidateVideoResult = { ok: true; video: ValidatedVideo } | { ok: false; reason: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/**
 * Validate a tutorial video source (a bare YouTube id or a YouTube URL) and
 * reduce it to a safe `youtube-nocookie.com` embed URL. Rejects any non-YouTube
 * host, non-http(s) protocol, or malformed id — the only inputs that may reach
 * the PiP iframe.
 */
export function validateVideoSrc(input: string): ValidateVideoResult {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty source' };

  // A bare 11-char video id is the common case (authored `VideoEntry.youtubeId`).
  if (VIDEO_ID.test(raw)) return accept(raw);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a video id or URL' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `disallowed protocol: ${url.protocol}` };
  }

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return { ok: false, reason: `host not allowlisted: ${host}` };

  const id = extractVideoId(url, host);
  if (!id || !VIDEO_ID.test(id)) return { ok: false, reason: 'no valid YouTube video id' };

  const result = accept(id, parseStart(url));
  if (!result.ok) return result;
  const embed = new URL(result.video.embedUrl);
  for (const key of ['hl', 'cc_lang_pref']) {
    const language = normalizeVideoLanguage(url.searchParams.get(key) ?? undefined);
    if (language) embed.searchParams.set(key, language);
  }
  if (url.searchParams.get('cc_load_policy') === '1') embed.searchParams.set('cc_load_policy', '1');
  result.video.embedUrl = embed.toString();
  return result;
}

function extractVideoId(url: URL, host: string): string | null {
  if (host === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;
  if (url.pathname === '/watch') return url.searchParams.get('v');
  const match = url.pathname.match(/^\/(?:embed|v|shorts)\/([^/?#]+)/);
  return match ? match[1] : null;
}

function parseStart(url: URL): number | undefined {
  const raw = url.searchParams.get('start') ?? url.searchParams.get('t');
  if (!raw) return undefined;
  const seconds = Number.parseInt(raw.replace(/s$/, ''), 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function accept(videoId: string, startSeconds?: number): ValidateVideoResult {
  const base = `https://www.youtube-nocookie.com/embed/${videoId}`;
  const embedUrl = startSeconds ? `${base}?start=${startSeconds}` : base;
  return { ok: true, video: { videoId, startSeconds, embedUrl } };
}
