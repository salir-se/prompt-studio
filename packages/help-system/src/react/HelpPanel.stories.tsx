// Plain CSF3 — no `@storybook/react-vite` import so the package's typecheck stays
// dependency-free (Storybook types are wired by the host app, not this package).
import type { FaqItem } from '../core/types';
import { HelpPanel } from './HelpPanel';

const meta = { title: 'Help/HelpPanel', component: HelpPanel };
export default meta;

const faq: FaqItem[] = [
  {
    id: 'scout.what',
    question: 'How do I start a search?',
    answer: 'Click Run Scout to begin a search.',
    pinned: true,
  },
  { id: 'scout.score', question: 'What does the signal score mean?', answer: 'A 0-100 delegation-readiness score.' },
  {
    id: 'scout.watch',
    question: 'Watch the Scout walkthrough',
    answer: 'A 2-minute tour of the Scout tab.',
    videoId: 'scout-intro',
  },
];

const videos = { 'scout-intro': { youtubeId: 'dQw4w9WgXcQ', title: 'Scout intro' } };

// FAQ + tours only — the baseline when the AI flag is off.
export const FaqOnly = {
  args: { pageKey: 'Scout', pageLabel: 'Scout', faq, videos, tourIds: ['Scout'], onClose: () => {} },
};

// AI surface enabled: the chat composer is shown beneath the FAQ.
export const WithChat = {
  args: {
    pageKey: 'Scout',
    pageLabel: 'Scout',
    faq,
    videos,
    aiEnabled: true,
    messages: [
      { id: 'm1', role: 'user', text: 'How do I run Scout?' },
      { id: 'm2', role: 'assistant', text: 'Open the Scout tab and click the Run Scout button to start a search.' },
    ],
    // Wiring this surfaces the header "+ New" control once the thread is non-empty.
    onNewConversation: () => {},
    onClose: () => {},
  },
};

// Conversation history — past conversations are archived (not deleted) by "+ New";
// the history clock beside it opens this browser. Click an entry to reopen it, or
// × to delete it. The list is newest-first, titled from each first user question.
export const WithConversationHistory = {
  args: {
    pageKey: 'Scout',
    pageLabel: 'Scout',
    faq,
    aiEnabled: true,
    messages: [
      { id: 'm1', role: 'user', text: 'How do I run Scout?' },
      { id: 'm2', role: 'assistant', text: 'Open the Scout tab and click the Run Scout button to start a search.' },
    ],
    conversations: [
      { id: 'c1', title: 'Where do I edit email drafts?', archivedAt: Date.now() - 5 * 60_000, messageCount: 4 },
      { id: 'c2', title: 'What does the signal score mean?', archivedAt: Date.now() - 3 * 3_600_000, messageCount: 2 },
      {
        id: 'c3',
        title: 'How does Salir learn from my results and how do I label outcomes for the learning loop?',
        archivedAt: Date.now() - 2 * 86_400_000,
        messageCount: 8,
      },
    ],
    onNewConversation: () => {},
    onOpenConversation: () => {},
    onDeleteConversation: () => {},
    onClose: () => {},
  },
};

// Markdown answer — the assistant replies in Markdown (bold, a numbered list, inline
// code, a link). The panel renders it as formatted text rather than raw `**`/`1.`.
export const WithMarkdownAnswer = {
  args: {
    pageKey: 'Settings',
    pageLabel: 'Settings',
    faq,
    aiEnabled: true,
    messages: [
      { id: 'm1', role: 'user', text: 'where i can edit email drafts?' },
      {
        id: 'm2',
        role: 'assistant',
        text: [
          'You edit drafts in the **Outreach** tab:',
          '',
          '1. Open the **Outreach** tab from the top navigation.',
          '2. Find the draft you want to change in the "Drafts" list.',
          '3. Click the **Edit** button on that draft’s card.',
          '4. After editing, press `Approve` to move the draft forward.',
          '',
          'See the [Admin Console](https://salir.se/admin) for workspace settings.',
        ].join('\n'),
        confidence: 'high',
      },
    ],
    onNewConversation: () => {},
    onClose: () => {},
  },
};

// In-flight — the user's question is sent and the assistant is composing a reply.
// A "Thinking…" placeholder turn reassures the user while the request is processing.
export const Thinking = {
  args: {
    pageKey: 'Scout',
    pageLabel: 'Scout',
    faq,
    aiEnabled: true,
    messages: [{ id: 'm1', role: 'user', text: 'How do I run Scout?' }],
    busy: true,
    onClose: () => {},
  },
};

// Mobile bottom-sheet layout (§G12) — the panel anchors to the bottom on phones.
export const Mobile = {
  args: {
    pageKey: 'Scout',
    pageLabel: 'Scout',
    faq,
    videos,
    tourIds: ['Scout'],
    variant: 'bottom-sheet',
    onClose: () => {},
  },
  parameters: { viewport: { defaultViewport: 'iphoneSE' } },
};

// Quota reached — the assistant declines further sends with a friendly notice.
export const QuotaReached = {
  args: {
    pageKey: 'Scout',
    pageLabel: 'Scout',
    faq,
    aiEnabled: true,
    messages: [
      { id: 'm1', role: 'user', text: 'Another question' },
      { id: 'm2', role: 'assistant', text: '', status: 'quota' },
    ],
    onClose: () => {},
  },
};

// Free model busy + workspace-LLM fallback OFFER: the newest busy answer carries
// a consent button ("Use my model (…)") with a cost caveat. Nothing is spent
// until the user accepts; the FAQ above stays usable.
export const BusyWithFallbackOffer = {
  args: {
    pageKey: 'Scout',
    pageLabel: 'Scout',
    faq,
    aiEnabled: true,
    messages: [
      { id: 'm1', role: 'user', text: 'How do I run Scout?' },
      { id: 'm2', role: 'assistant', text: '', status: 'busy', fallback: { label: 'anthropic · claude-sonnet' } },
    ],
    onAcceptFallback: () => {},
    onClose: () => {},
  },
};

// Consent granted: the strip above the composer keeps the "Stop using my model"
// revoke control visible for the whole session, so switching back is one click.
export const FallbackConsentGranted = {
  args: {
    pageKey: 'Scout',
    pageLabel: 'Scout',
    faq,
    aiEnabled: true,
    messages: [
      { id: 'm1', role: 'user', text: 'How do I run Scout?' },
      { id: 'm2', role: 'assistant', text: 'Open the Scout tab and press Run Scout.' },
    ],
    fallbackConsent: true,
    fallbackLabel: 'anthropic · claude-sonnet',
    onRevokeFallback: () => {},
    onClose: () => {},
  },
};

// Source chips + confidence (§G5). NOTE: this is a RENDER SEAM — the panel shows
// chips/confidence only when the runner populated `sources`/`confidence` on the
// message. Populating them is a follow-up: the inference prompt must be taught to
// return them. The first answer is high-confidence with two sources; the second is
// low-confidence, which adds a "double-check" caveat and (with `onEscalateSupport`)
// surfaces the Contact-support affordance — without hiding the answer text.
export const WithSources = {
  args: {
    pageKey: 'Scout',
    pageLabel: 'Scout',
    faq,
    aiEnabled: true,
    messages: [
      { id: 'm1', role: 'user', text: 'How do I start a search?' },
      {
        id: 'm2',
        role: 'assistant',
        text: 'Open the Scout tab and click Run Scout to begin a search.',
        confidence: 'high',
        sources: [
          { type: 'faq', id: 'scout.what', title: 'How do I start a search?' },
          { type: 'material', id: 'scout-guide', title: 'Scout guide' },
        ],
      },
      { id: 'm3', role: 'user', text: 'Does Scout support boolean search operators?' },
      {
        id: 'm4',
        role: 'assistant',
        text: "I believe Scout accepts simple keywords, but I'm not certain it supports boolean operators.",
        confidence: 'low',
        sources: [{ type: 'page_context', id: 'scout', title: 'Scout page' }],
      },
    ],
    onEscalateSupport: () => {},
    onClose: () => {},
  },
};
