// Plain CSF3 — no `@storybook/react-vite` import so the package's typecheck stays
// dependency-free (Storybook types are wired by the host app, not this package).
import { PipPlayer } from './PipPlayer';

const meta = { title: 'Help/PipPlayer', component: PipPlayer };
export default meta;

export const Default = {
  args: { youtubeId: 'dQw4w9WgXcQ', title: 'Scout intro', onClose: () => {} },
};

export const WithMinimize = {
  args: { youtubeId: 'dQw4w9WgXcQ', title: 'Scout intro', onClose: () => {}, onMinimize: () => {} },
};

export const InvalidSource = {
  args: { src: 'https://evil.com/x', title: 'Blocked source', onClose: () => {} },
};

// Forces the fallback branch (ADR-275 D11): a document that enforces
// cross-origin isolation but whose browser cannot render a `credentialless`
// iframe. Real-world example: COEP is active but the credentialless iframe
// attribute isn't supported yet. Shows the "Open on YouTube" link-out card
// instead of a blocked/blank embed.
export const LinkOutFallback = {
  args: {
    youtubeId: 'dQw4w9WgXcQ',
    title: 'Scout intro',
    onClose: () => {},
    detectEmbedMode: () => 'link-out' as const,
  },
};

// The verified source has Russian automatic captions; playback requests a Swedish translation.
export const BrowserLanguageCaptions = {
  args: {
    youtubeId: 'PVvOu7YhQrs',
    title: 'System screens overview',
    locale: 'sv-SE',
    captionTrack: { languageCode: 'ru', kind: 'asr' as const },
    onClose: () => {},
  },
};

export const CaptionLinkOutFallback = {
  args: {
    ...BrowserLanguageCaptions.args,
    detectEmbedMode: () => 'link-out' as const,
  },
};

export const SubtitleInstructions = {
  args: BrowserLanguageCaptions.args,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    canvasElement.querySelector('details')?.setAttribute('open', '');
  },
};
