import { type } from 'arktype';
import type { HelpContent } from './types';

// Runtime validation of the host-supplied content registry (arktype, ADR-066).
// Keeps the authoring surface honest: a malformed entry fails fast at module
// load in dev/CI rather than silently rendering nothing at runtime.

// Editorial governance (G9). `status` absent ⇒ published.
const contentMeta = type({
  'owner?': 'string',
  'status?': "'draft' | 'review' | 'published' | 'archived'",
  'version?': 'number',
  'lastReviewedAt?': 'string',
  'expiresAt?': 'string',
  'changelog?': 'string',
});

const videoEntry = type({
  youtubeId: 'string',
  title: 'string',
  'startSeconds?': 'number',
  'captionTrack?': { languageCode: 'string', 'kind?': "'asr'" },
  'meta?': contentMeta,
});

const faqItem = type({
  id: 'string',
  question: 'string',
  answer: 'string',
  'videoId?': 'string',
  'flag?': 'string',
  'experiment?': { key: 'string', variant: 'string' },
  'hidden?': 'boolean',
  'pinned?': 'boolean',
  'priority?': 'number',
  'meta?': contentMeta,
});

const highlightable = type({
  helpId: 'string',
  label: 'string',
  description: 'string',
});

const aiContext = type({
  'systemPromptAppendix?': 'string',
  'materials?': type({ title: 'string', body: 'string' }).array(),
});

const pageContent = type({
  pageLabel: 'string',
  faq: faqItem.array(),
  'highlightables?': highlightable.array(),
  'aiContext?': aiContext,
  'meta?': contentMeta,
});

const helpContentSchema = type({
  pages: type({ '[string]': pageContent }),
  'videos?': type({ '[string]': videoEntry }),
});

/**
 * Validate and return a host-supplied help content registry.
 *
 * Runs the arktype schema at call time (typically module load); throws a clear,
 * single-line error on a malformed entry so authoring mistakes fail fast. The
 * input is returned unchanged and narrowly typed, so authors keep autocomplete
 * on page keys, FAQ ids, etc. All content is English (ADR-089 — i18n is runtime).
 */
export function defineHelpContent<const T extends HelpContent>(content: T): T {
  const out = helpContentSchema(content);
  if (out instanceof type.errors) {
    throw new Error(`Invalid help content: ${out.summary}`);
  }
  return content;
}
