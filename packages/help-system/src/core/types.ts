// Core content model for @prompt-studio/help-system (ADR-089).
//
// These are the types a host app supplies via `defineHelpContent`. All content
// is authored in ENGLISH; the assistant translates at runtime. Framework-agnostic
// (no React, no `@prompt-studio/*`) so this layer can become `@prompt-studio/help-system-core`.

/**
 * Editorial lifecycle of a content node (ADR-089 §8a G9). Absent ⇒ treated as
 * `published` (back-compatible: existing content with no `meta` keeps rendering).
 */
export type ContentStatus = 'draft' | 'review' | 'published' | 'archived';

/**
 * Governance metadata for a content node — who owns it, where it is in the
 * editorial lifecycle, and when it goes stale. Only `published`, non-expired
 * content renders ({@link isPublished}); the rest surfaces in an author review
 * queue ({@link staleContent}). `version` also keys the translation cache (G10),
 * so an English edit (bumped `version`) invalidates stale translations.
 */
export interface ContentMeta {
  /** Team or person responsible for the content. */
  owner?: string;
  /** Editorial status; absent ⇒ `published`. */
  status?: ContentStatus;
  /** Monotonic content version; bump on every edit (drives translation-cache invalidation). */
  version?: number;
  /** ISO timestamp of the last editorial review. */
  lastReviewedAt?: string;
  /** ISO timestamp after which the content is considered stale and is hidden. */
  expiresAt?: string;
  /** Optional human-readable note about the latest change. */
  changelog?: string;
}

/** A YouTube tutorial video with an optional authored caption source. */
export interface VideoEntry {
  /** YouTube video id (the authored source, which may have non-English audio). */
  youtubeId: string;
  /** Verified source caption track; enables translation when only source-language captions exist. */
  captionTrack?: { languageCode: string; kind?: 'asr' };
  title: string;
  /** Optional start offset in seconds. */
  startSeconds?: number;
  /** Editorial governance (G9). */
  meta?: ContentMeta;
}

/** Registry of tutorial videos keyed by a stable video id (referenced from FAQ items). */
export type VideoRegistry = Record<string, VideoEntry>;

/** A single FAQ entry. English-authored; the assistant translates on request. */
export interface FaqItem {
  /** Stable id, namespaced by page (e.g. `scout.what`). */
  id: string;
  question: string;
  answer: string;
  /** Optional tutorial video — a key into the {@link VideoRegistry}. */
  videoId?: string;
  /** Gate this item behind a boolean feature flag (resolved by the host). */
  flag?: string;
  /** A/B gate: render only when the host variant resolver returns `variant`. */
  experiment?: { key: string; variant: string };
  /** Hard hide regardless of flags. */
  hidden?: boolean;
  /** Pin to the top of the curated top-N shown on open. */
  pinned?: boolean;
  /** Manual ranking weight (higher = earlier) when not pinned and no popularity signal. */
  priority?: number;
  /** Editorial governance (G9): unpublished/expired items are hidden. */
  meta?: ContentMeta;
}

/** An on-screen element the assistant may reference or highlight, by its `data-help-id`. */
export interface HighlightableDescriptor {
  /** Matches a `data-help-id="…"` attribute in the host UI. */
  helpId: string;
  /** Short human label (e.g. "Run Scout"). */
  label: string;
  /** One line describing what the element does (fed into the assistant prompt). */
  description: string;
}

/** Per-page extra material that grounds the assistant's answers. */
export interface HelpAiContext {
  /** Appended to the assistant system prompt for this page. */
  systemPromptAppendix?: string;
  /** Reference snippets concatenated into the grounding block. */
  materials?: Array<{ title: string; body: string }>;
}

/** Help content for a single page/tab. */
export interface HelpPageContent {
  /** Human-readable page name shown to the user and the assistant. */
  pageLabel: string;
  faq: FaqItem[];
  /** Elements the assistant can spotlight on this page. */
  highlightables?: HighlightableDescriptor[];
  /** Extra AI grounding material for this page. */
  aiContext?: HelpAiContext;
  /** Editorial governance (G9) for the page as a whole. */
  meta?: ContentMeta;
}

/** The full content registry a host app supplies to the help system. */
export interface HelpContent {
  /** Help content keyed by page/tab key. */
  pages: Record<string, HelpPageContent>;
  /** Tutorial videos referenced by FAQ items. */
  videos?: VideoRegistry;
}
