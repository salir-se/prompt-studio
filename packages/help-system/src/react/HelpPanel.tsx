import Fuse, { type IFuseOptions } from 'fuse.js';
import { type FormEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { HelpConfidence, HelpSource } from '../core/adapters';
import type { ConversationSummary, HelpMessage } from '../core/history';
import { selectTopFaq } from '../core/selectTopFaq';
import type { FaqItem, VideoRegistry } from '../core/types';
import { FaqAccordion } from './FaqAccordion';
import { Markdown } from './Markdown';
import { ThinkingIndicator } from './ThinkingIndicator';

// The non-modal help panel (ADR-089).
//
// Presentational + read-only: it renders the current page's FAQ, an optional
// guided-tour launcher, and (when AI is enabled) a minimal chat surface — and it
// reports intent through callbacks. It owns NO help state and NO context, so its
// Storybook stories render standalone; `HelpProvider` threads the live state in.
//
// NON-MODAL by design: `role="dialog"` + `aria-modal="false"` and NO focus trap,
// so the user can still Tab to (and act on) the highlighted app controls while
// the panel guides them.

export interface HelpPanelProps {
  /** Host-owned report UI and history. Evidence never enters AI conversation messages. */
  supportDraft?: {
    active: boolean;
    actions: ReactNode;
    content: ReactNode;
    onCommand: (text: string) => boolean;
    history?: {
      label: string;
      entries: { id: string; title: string; updatedAt: number }[];
      onOpen: (id: string) => void;
    };
  };
  /** Current page/tab key (namespaces FAQ ids + analytics). */
  pageKey: string;
  /** Human-readable page name shown in the header. */
  pageLabel: string;
  /** The page's authored FAQ list (gating + ranking handled downstream). */
  faq: FaqItem[];
  /** Video registry — resolves an FAQ item's `videoId` to a preview thumbnail. */
  videos?: VideoRegistry;
  /** Boolean feature-flag resolver (FAQ item gating). */
  featureFlag?: (key: string) => boolean;
  /** A/B variant resolver (FAQ experiment gating). */
  getVariant?: (key: string) => string | undefined;
  /** "Most-asked" popularity signal feeding FAQ top-N ranking. */
  popularity?: Record<string, number>;
  /** Fired with the FAQ id when an item is expanded (analytics). */
  onOpenFaq?: (faqId: string) => void;
  /** Fired with the registry video id when a video preview is played. */
  onWatchVideo?: (videoId: string) => void;
  /** Tour ids available on this page — render a launcher per id when non-empty. */
  tourIds?: string[];
  /** Fired with a tour id when the user starts a guided tour. */
  onStartTour?: (tourId: string) => void;
  /** Whether the AI chat surface is shown. When false the panel is FAQ + tours only. */
  aiEnabled?: boolean;
  /** The conversation so far (chat). */
  messages?: HelpMessage[];
  /** Fired with the trimmed text when the user sends a chat message. */
  onSend?: (text: string) => void;
  /**
   * Archive the current chat thread and start fresh. When provided, a "New"
   * control appears in the header once the thread is non-empty. Omit it to hide
   * the affordance entirely.
   */
  onNewConversation?: () => void;
  /** Past conversations for the history browser, newest first (summaries only). */
  conversations?: ConversationSummary[];
  /**
   * Reopen an archived conversation by id. When provided (and there are archived
   * conversations), a history (clock) control appears beside "New".
   */
  onOpenConversation?: (id: string) => void;
  /** Permanently delete an archived conversation by id (× in the history list). */
  onDeleteConversation?: (id: string) => void;
  /**
   * Fired with the query + local-FAQ match count when the user submits a question
   * (§G2 local-search-before-AI). Lets the host record `help.search.performed`.
   */
  onSearch?: (query: string, resultCount: number) => void;
  /** Fired when the user rates an assistant answer 👍/👎 (§G3). */
  onFeedback?: (input: { messageId: string; rating: 'up' | 'down' }) => void;
  /**
   * Human-support escape hatch (§G4). When provided, a subtle "Contact support"
   * button auto-surfaces after a quota/error answer, a low-confidence answer, or a
   * fruitless local search. Omit it to hide the affordance entirely.
   */
  onEscalateSupport?: () => void;
  /**
   * Consented-cost fallback controls. `fallbackConsent` is the live per-session
   * grant; a busy answer carrying a `fallback` offer renders an accept button
   * (wired to `onAcceptFallback`), and while granted a strip above the composer
   * lets the user revoke via `onRevokeFallback` ("stop using my model").
   */
  fallbackConsent?: boolean;
  /** Label of the consented fallback model (shown in the revoke strip). */
  fallbackLabel?: string | null;
  onAcceptFallback?: () => void;
  onRevokeFallback?: () => void;
  /** Whether a send is in flight (disables the input). */
  busy?: boolean;
  /** Layout: a right-edge `side` panel (desktop) or a `bottom-sheet` (mobile, §G12). Default `side`. */
  variant?: 'side' | 'bottom-sheet';
  /** Close the panel. */
  onClose: () => void;
}

// Above the launcher (2147482000), below the spotlight overlay (2147483000).
const PANEL_Z_INDEX = 2147482500;

// Fuse tuning mirrors `FaqAccordion`'s search so "found in help" and the FAQ search
// agree on what counts as a match (DRY — same threshold, same keys).
const FAQ_FUSE_OPTIONS: IFuseOptions<FaqItem> = { keys: ['question', 'answer'], threshold: 0.4, ignoreLocation: true };

/** Humanize a tour id for the launcher label when more than one tour is offered. */
function tourButtonLabel(tourId: string, multiple: boolean): string {
  return multiple ? `Take a tour: ${tourId}` : 'Take a tour';
}

/** Style for a 👍/👎 answer-feedback button; `active` marks the chosen rating. */
function feedbackButtonStyle(active: boolean): React.CSSProperties {
  return {
    border: '1px solid var(--border, #d4d4d8)',
    borderRadius: 6,
    background: active ? 'var(--accent, #e0e7ff)' : 'transparent',
    cursor: 'pointer',
    padding: '2px 6px',
    font: '12px/1 system-ui, sans-serif',
    opacity: active ? 1 : 0.7,
  };
}

/** Human-readable confidence label shown beneath an assistant answer (§G5). */
const CONFIDENCE_LABEL: Record<HelpConfidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

/**
 * A subtle, link-styled "Still stuck? Contact support" button (§G4). Rendered
 * only when the host wired `onEscalateSupport`; the caller decides when to surface
 * it (quota/error answer, low confidence, or a fruitless local search).
 */
function SupportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      data-help-support
      onClick={onClick}
      style={{
        alignSelf: 'flex-start',
        marginTop: 8,
        padding: 0,
        border: 'none',
        background: 'transparent',
        color: 'var(--primary, #2563eb)',
        font: '600 13px/1.2 system-ui, sans-serif',
        cursor: 'pointer',
        textDecoration: 'underline',
      }}
    >
      Still stuck? Contact support
    </button>
  );
}

/**
 * The "Found in help" suggestions surfaced before spending tokens (§G2): a compact,
 * accessible accordion of the FAQ items that match the user's question. Each row is
 * a header `<button aria-expanded aria-controls>` followed by its named answer panel
 * — the same a11y shape as {@link FaqAccordion}, kept compact for the chat composer.
 */
function FaqSuggestions({ items, onOpen }: { items: FaqItem[]; onOpen?: (faqId: string) => void }) {
  const baseId = `help-suggest-${useId().replace(/:/g, '')}`;
  const labelId = `${baseId}-label`;
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (item: FaqItem) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
        onOpen?.(item.id);
      }
      return next;
    });
  };

  return (
    <section
      data-help-faq-suggestions
      aria-labelledby={labelId}
      style={{ margin: '12px 0 0', font: '14px/1.5 system-ui, sans-serif' }}
    >
      <p id={labelId} style={{ margin: '0 0 6px', font: '600 12px/1.3 system-ui, sans-serif', opacity: 0.8 }}>
        Found in help
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item) => {
          const panelId = `${baseId}-panel-${item.id}`;
          const headerId = `${baseId}-header-${item.id}`;
          const isOpen = open.has(item.id);
          return (
            <li
              key={item.id}
              style={{ border: '1px solid var(--border, #e4e4e7)', borderRadius: 8, overflow: 'hidden' }}
            >
              <button
                type="button"
                id={headerId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(item)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  width: '100%',
                  padding: '8px 10px',
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  font: '600 13px/1.4 system-ui, sans-serif',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span>{item.question}</span>
                <span aria-hidden="true" style={{ flexShrink: 0, opacity: 0.6 }}>
                  {isOpen ? '−' : '+'}
                </span>
              </button>
              <section
                id={panelId}
                aria-labelledby={headerId}
                hidden={!isOpen}
                style={{ padding: isOpen ? '0 10px 10px' : 0 }}
              >
                <p style={{ margin: 0 }}>{item.answer}</p>
              </section>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A row of "Based on: …" source chips under an assistant answer (§G5). */
function SourceChips({ sources }: { sources: HelpSource[] }) {
  return (
    <ul
      data-help-sources
      aria-label="Answer sources"
      style={{
        listStyle: 'none',
        margin: '6px 0 0',
        padding: 0,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
      }}
    >
      {sources.map((source) => (
        <li
          key={`${source.type}:${source.id}`}
          data-help-source-type={source.type}
          style={{
            padding: '2px 8px',
            borderRadius: 999,
            border: '1px solid var(--border, #d4d4d8)',
            background: 'var(--muted, #f4f4f5)',
            font: '11px/1.4 system-ui, sans-serif',
            opacity: 0.9,
          }}
        >
          Based on: {source.title}
        </li>
      ))}
    </ul>
  );
}

/** Compact "x ago" label for an archive timestamp (falls back to a local date). */
function relativeTime(ts: number, now: number = Date.now()): string {
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** A small clock glyph for the "history" toggle (stroke follows `currentColor`). */
function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/**
 * The "Past conversations" browser (§history). Replaces the panel body while open
 * so it never overflows the floating dialog. Each row reopens its conversation;
 * the × deletes it. Rendered only when the host wired `onOpenConversation`.
 */
function ConversationHistory({
  conversations,
  reports,
  onOpen,
  onDelete,
  onBack,
}: {
  conversations: ConversationSummary[];
  reports?: NonNullable<HelpPanelProps['supportDraft']>['history'];
  onOpen: (id: string) => void;
  onDelete?: (id: string) => void;
  onBack: () => void;
}) {
  const rows = [
    ...conversations.map((entry) => ({ ...entry, report: false })),
    ...(reports?.entries ?? []).map((entry) => ({
      ...entry,
      archivedAt: entry.updatedAt,
      messageCount: 0,
      report: true,
    })),
  ].sort((a, b) => b.archivedAt - a.archivedAt);
  return (
    <section data-help-history aria-label="Past conversations">
      <button
        type="button"
        onClick={onBack}
        style={{
          marginBottom: 12,
          padding: 0,
          border: 'none',
          background: 'transparent',
          color: 'var(--primary, #2563eb)',
          font: '600 13px/1.2 system-ui, sans-serif',
          cursor: 'pointer',
        }}
      >
        ← Back
      </button>
      <p style={{ margin: '0 0 8px', font: '600 12px/1.3 system-ui, sans-serif', opacity: 0.8 }}>Past conversations</p>
      {rows.length === 0 ? (
        <p style={{ margin: 0, opacity: 0.7, font: '13px/1.5 system-ui, sans-serif' }}>No saved conversations yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((c) => (
            <li
              key={`${c.report ? 'report' : 'chat'}-${c.id}`}
              style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}
            >
              <button
                type="button"
                data-help-history-item
                onClick={() => (c.report ? reports?.onOpen(c.id) : onOpen(c.id))}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: '1px solid var(--border, #e4e4e7)',
                  borderRadius: 8,
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    font: '600 13px/1.3 system-ui, sans-serif',
                  }}
                >
                  {c.title}
                </span>
                <span style={{ display: 'block', marginTop: 2, opacity: 0.6, font: '12px/1.2 system-ui, sans-serif' }}>
                  {relativeTime(c.archivedAt)} ·{' '}
                  {c.report ? reports?.label : `${c.messageCount} message${c.messageCount === 1 ? '' : 's'}`}
                </span>
              </button>
              {onDelete && !c.report ? (
                <button
                  type="button"
                  aria-label={`Delete conversation: ${c.title}`}
                  title="Delete"
                  onClick={() => onDelete(c.id)}
                  style={{
                    flexShrink: 0,
                    width: 28,
                    border: '1px solid var(--border, #e4e4e7)',
                    borderRadius: 8,
                    background: 'transparent',
                    color: 'inherit',
                    cursor: 'pointer',
                    opacity: 0.7,
                    font: '14px/1 system-ui, sans-serif',
                  }}
                >
                  {'×'}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function HelpPanel({
  supportDraft,
  pageKey,
  pageLabel,
  faq,
  videos,
  featureFlag,
  getVariant,
  popularity,
  onOpenFaq,
  onWatchVideo,
  tourIds,
  onStartTour,
  aiEnabled = false,
  messages = [],
  onSend,
  onNewConversation,
  conversations = [],
  onOpenConversation,
  onDeleteConversation,
  onSearch,
  onFeedback,
  onEscalateSupport,
  fallbackConsent = false,
  fallbackLabel = null,
  onAcceptFallback,
  onRevokeFallback,
  busy = false,
  variant = 'side',
  onClose,
}: HelpPanelProps) {
  const titleId = `help-panel-title-${useId().replace(/:/g, '')}`;
  const [draft, setDraft] = useState('');
  // Whether the "Past conversations" browser is showing (replaces the body).
  const [showHistory, setShowHistory] = useState(false);
  // Remember which answers were rated so the chosen thumb stays highlighted.
  const [ratings, setRatings] = useState<Record<string, 'up' | 'down'>>({});
  // §G2 "local search before AI": when a submitted question matches the FAQ we
  // stash the matches + the query that produced them and show suggestions instead
  // of calling the AI. `noLocalResult` drives the support auto-surface (§G4).
  const [pending, setPending] = useState<{ query: string; matches: FaqItem[] } | null>(null);
  const [noLocalResult, setNoLocalResult] = useState(false);

  // The full gate-passing FAQ (no top-N cap) backs local search — same gating the
  // FAQ accordion uses so suggestions are drawn from exactly the visible corpus.
  const gatedFaq = useMemo(
    () => selectTopFaq(faq, { limit: Number.POSITIVE_INFINITY, popularity, featureFlag, getVariant }),
    [faq, popularity, featureFlag, getVariant],
  );
  const fuse = useMemo(() => new Fuse(gatedFaq, FAQ_FUSE_OPTIONS), [gatedFaq]);

  const rate = (messageId: string, rating: 'up' | 'down') => {
    setRatings((prev) => ({ ...prev, [messageId]: rating }));
    onFeedback?.({ messageId, rating });
  };

  /**
   * Hand the query to the assistant and clear the "Found in help" surface. The
   * `noLocalResult` flag (which keeps the §G4 support button up after a fruitless
   * search) is left untouched — the caller owns it.
   */
  const escalateToAssistant = (query: string) => {
    onSend?.(query);
    setPending(null);
    setDraft('');
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    if (supportDraft?.onCommand(text)) {
      setDraft('');
      setPending(null);
      return;
    }

    // "Send again" on the same query (suggestions already shown) ⇒ spend tokens.
    if (pending && pending.query === text) {
      escalateToAssistant(text);
      return;
    }

    // §G2: try local help first. Strong matches deflect the AI; none ⇒ ask the AI
    // and surface the §G4 support escape hatch (the FAQ couldn't help either).
    const matches = fuse.search(text).map((r) => r.item);
    onSearch?.(text, matches.length);
    if (matches.length > 0) {
      setPending({ query: text, matches });
      setNoLocalResult(false);
    } else {
      setNoLocalResult(true);
      escalateToAssistant(text);
    }
  };

  // §G4 support auto-surface: a quota/error last answer, a low-confidence last
  // answer (§G5 — don't present a shaky answer as the only option), OR a fruitless
  // local search. Hidden entirely unless the host wired `onEscalateSupport`.
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const lastAnswerFailed =
    lastAssistant?.status === 'quota' || lastAssistant?.status === 'error' || lastAssistant?.status === 'busy';

  // Keep the newest turn visible: scroll the thread's tail into view whenever a
  // message lands or the thinking indicator toggles (jsdom lacks scrollIntoView,
  // hence the optional call).
  const threadEndRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    threadEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, busy]);
  const lastAnswerLowConfidence = lastAssistant?.confidence === 'low';
  const showSupport = !!onEscalateSupport && (lastAnswerFailed || lastAnswerLowConfidence || noLocalResult);

  // Desktop: a floating dialog anchored bottom-left, just above the "?" launcher.
  // Mobile: a bottom-sheet that leaves the top of the app visible so users can
  // still see (and act on) highlighted controls.
  const layout: React.CSSProperties =
    variant === 'bottom-sheet'
      ? {
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: '80vh',
          width: '100%',
          borderTop: '1px solid var(--border, #e4e4e7)',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          boxShadow: '0 -8px 30px rgba(0,0,0,0.18)',
        }
      : {
          // Floating dialog anchored bottom-left, sitting ABOVE the "?" launcher
          // (left:16, bottom:16, 48×48) with a 12px gap so the two never overlap.
          left: 16,
          bottom: 76,
          width: 'min(400px, calc(100vw - 32px))',
          maxHeight: 'min(620px, calc(100vh - 92px))',
          border: '1px solid var(--border, #e4e4e7)',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 12px 40px rgba(0,0,0,0.28)',
        };

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-help-panel
      data-help-page={pageKey}
      data-help-variant={variant}
      style={{
        position: 'fixed',
        zIndex: PANEL_Z_INDEX,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--background, #fff)',
        color: 'var(--foreground, #18181b)',
        font: '14px/1.5 system-ui, sans-serif',
        ...layout,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '12px 16px',
          borderBottom: '1px solid var(--border, #e4e4e7)',
        }}
      >
        <h2 id={titleId} style={{ margin: 0, font: '600 15px/1.3 system-ui, sans-serif' }}>
          Help — {pageLabel}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {/* Start a fresh thread — only meaningful once a conversation exists, and
              only when the host wired the handler. Disabled mid-send to avoid
              dropping a thread while a reply is in flight. */}
          {aiEnabled && !supportDraft?.active && onNewConversation && messages.length > 0 ? (
            <button
              type="button"
              data-help-new-conversation
              aria-label="Start a new conversation"
              title="Start a new conversation"
              disabled={busy}
              onClick={onNewConversation}
              style={{
                height: 28,
                padding: '0 10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                border: '1px solid var(--border, #d4d4d8)',
                borderRadius: 6,
                background: 'transparent',
                color: 'inherit',
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.5 : 1,
                font: '600 12px/1 system-ui, sans-serif',
              }}
            >
              <span aria-hidden="true">+</span> New
            </button>
          ) : null}
          {/* History (clock) — browse past conversations. Shown once anything is
              archived; toggles the browser in the panel body. */}
          {!supportDraft?.active &&
          ((aiEnabled && onOpenConversation && conversations.length > 0) || !!supportDraft?.history?.entries.length) ? (
            <button
              type="button"
              data-help-history-toggle
              aria-label="Past conversations"
              title="Past conversations"
              aria-expanded={showHistory}
              disabled={busy}
              onClick={() => setShowHistory((prev) => !prev)}
              style={{
                height: 28,
                width: 28,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--border, #d4d4d8)',
                borderRadius: 6,
                background: showHistory ? 'var(--accent, #e0e7ff)' : 'transparent',
                color: 'inherit',
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.5 : 1,
              }}
            >
              <ClockIcon />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Close help"
            onClick={onClose}
            style={{
              flexShrink: 0,
              width: 28,
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              borderRadius: 6,
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              font: '18px/1 system-ui, sans-serif',
            }}
          >
            {'×'}
          </button>
        </div>
      </header>

      {supportDraft?.active ? supportDraft.content : supportDraft?.actions}

      {/* Past-conversations browser — swaps in for the body while open. The normal
          body below stays mounted (hidden) so FAQ/chat state survives the toggle. */}
      {showHistory && !supportDraft?.active && (onOpenConversation || supportDraft?.history) ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
          <ConversationHistory
            conversations={aiEnabled ? conversations : []}
            reports={
              supportDraft?.history
                ? {
                    ...supportDraft.history,
                    onOpen: (id) => {
                      setShowHistory(false);
                      supportDraft.history?.onOpen(id);
                    },
                  }
                : undefined
            }
            onOpen={(id) => {
              setShowHistory(false);
              onOpenConversation?.(id);
            }}
            onDelete={onDeleteConversation}
            onBack={() => setShowHistory(false)}
          />
        </div>
      ) : null}

      {/* Scrollable body: tours, FAQ, and (when enabled) the chat thread. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 16,
          ...(showHistory || supportDraft?.active ? { display: 'none' } : {}),
        }}
      >
        {tourIds && tourIds.length > 0 ? (
          <div data-help-tours style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {tourIds.map((tourId) => (
              <button
                key={tourId}
                type="button"
                onClick={() => onStartTour?.(tourId)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border, #d4d4d8)',
                  background: 'var(--muted, #f4f4f5)',
                  color: 'inherit',
                  font: '600 13px/1.2 system-ui, sans-serif',
                  cursor: 'pointer',
                }}
              >
                {tourButtonLabel(tourId, tourIds.length > 1)}
              </button>
            ))}
          </div>
        ) : null}

        <FaqAccordion
          items={faq}
          pageKey={pageKey}
          videos={videos}
          featureFlag={featureFlag}
          getVariant={getVariant}
          popularity={popularity}
          onOpenItem={onOpenFaq}
          onWatchVideo={onWatchVideo}
        />

        {aiEnabled && messages.length > 0 ? (
          <ul
            // role="log" + aria-live so new assistant turns — and the in-flight
            // "Thinking…" indicator — are announced to screen readers.
            role="log"
            aria-live="polite"
            aria-busy={busy}
            aria-label="Conversation"
            style={{
              listStyle: 'none',
              margin: '16px 0 0',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {messages.map((message, index) => {
              const isAssistant = message.role === 'assistant';
              const lowConfidence = isAssistant && message.confidence === 'low';
              return (
                <li
                  key={message.id}
                  data-help-message-role={message.role}
                  style={{
                    alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                    display: 'flex',
                    flexDirection: 'column',
                    maxWidth: '85%',
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: message.role === 'user' ? 'var(--primary, #2563eb)' : 'var(--muted, #f4f4f5)',
                    color: message.role === 'user' ? 'var(--primary-foreground, #fff)' : 'inherit',
                  }}
                >
                  {/* Assistant turns are Markdown (bold, lists, links); user turns are
                      shown verbatim so their literal text is never reinterpreted. */}
                  {isAssistant ? <Markdown text={message.text} /> : message.text}
                  {message.status === 'quota' ? (
                    <span style={{ display: 'block', marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                      Daily help limit reached.
                    </span>
                  ) : null}
                  {message.status === 'busy' ? (
                    <span style={{ display: 'block', marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                      The assistant is busy right now — try again in a minute. The FAQ above still works.
                    </span>
                  ) : null}
                  {/* Consented-cost fallback offer: only on the newest busy answer,
                      only before consent is granted, only when the host can accept. */}
                  {message.status === 'busy' &&
                  message.fallback &&
                  !fallbackConsent &&
                  onAcceptFallback &&
                  index === messages.length - 1 ? (
                    <span style={{ display: 'block', marginTop: 8 }}>
                      <button
                        type="button"
                        onClick={onAcceptFallback}
                        disabled={busy}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 8,
                          border: '1px solid var(--border, #d4d4d8)',
                          background: 'var(--primary, #2563eb)',
                          color: 'var(--primary-foreground, #fff)',
                          font: '600 12px/1.2 system-ui, sans-serif',
                          cursor: busy ? 'default' : 'pointer',
                        }}
                      >
                        Use my model ({message.fallback.label})
                      </button>
                      <span style={{ display: 'block', marginTop: 4, fontSize: 11, opacity: 0.75 }}>
                        Answers this question with your workspace LLM — uses your API key and counts toward your
                        spending cap. You can stop it anytime.
                      </span>
                    </span>
                  ) : null}
                  {message.status === 'error' ? (
                    <span style={{ display: 'block', marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                      The assistant is unavailable right now — the FAQ above still works.
                    </span>
                  ) : null}
                  {/* §G5 source chips — shown only when the runner populated them. */}
                  {isAssistant && message.sources && message.sources.length > 0 ? (
                    <SourceChips sources={message.sources} />
                  ) : null}
                  {/* §G5 confidence label; for `low` we add a one-line "double-check" caveat
                      rather than hiding the answer, and offer the support escape hatch. */}
                  {isAssistant && message.confidence ? (
                    <span
                      data-help-confidence={message.confidence}
                      style={{ display: 'block', marginTop: 4, fontSize: 11, opacity: 0.7 }}
                    >
                      {CONFIDENCE_LABEL[message.confidence]}
                    </span>
                  ) : null}
                  {lowConfidence ? (
                    <span
                      data-help-low-confidence
                      style={{ display: 'block', marginTop: 4, fontSize: 12, opacity: 0.85 }}
                    >
                      I'm not fully sure — please double-check against the FAQ above or contact support.
                    </span>
                  ) : null}
                  {isAssistant && message.text ? (
                    <div data-help-feedback style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                      <button
                        type="button"
                        aria-label="Helpful"
                        aria-pressed={ratings[message.id] === 'up'}
                        onClick={() => rate(message.id, 'up')}
                        style={feedbackButtonStyle(ratings[message.id] === 'up')}
                      >
                        👍
                      </button>
                      <button
                        type="button"
                        aria-label="Not helpful"
                        aria-pressed={ratings[message.id] === 'down'}
                        onClick={() => rate(message.id, 'down')}
                        style={feedbackButtonStyle(ratings[message.id] === 'down')}
                      >
                        👎
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
            {/* In-flight placeholder while the assistant composes a reply (§G). */}
            {busy ? <ThinkingIndicator /> : null}
            {/* Auto-scroll sentinel: keep the newest answer (and any consent
                offer it carries) in view — on small screens it otherwise lands
                below the fold. */}
            <li aria-hidden ref={threadEndRef} style={{ listStyle: 'none', height: 0 }} />
          </ul>
        ) : null}

        {/* §G2 "Found in help": local suggestions + an explicit escape hatch to the AI. */}
        {aiEnabled && pending ? (
          <>
            <FaqSuggestions items={pending.matches} onOpen={onOpenFaq} />
            <button
              type="button"
              data-help-ask-anyway
              onClick={() => escalateToAssistant(pending.query)}
              style={{
                marginTop: 8,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--border, #d4d4d8)',
                background: 'var(--muted, #f4f4f5)',
                color: 'inherit',
                font: '600 13px/1.2 system-ui, sans-serif',
                cursor: 'pointer',
              }}
            >
              Ask the assistant anyway
            </button>
          </>
        ) : null}

        {/* §G4 human-support escape hatch — auto-surfaced when the AI couldn't help
            or local search came up empty. Hidden unless the host wired the sink. */}
        {showSupport && onEscalateSupport ? <SupportButton onClick={onEscalateSupport} /> : null}
      </div>

      {/* Consented-fallback strip: while the session grant is active, keep the
          "stop using my model" control visible so switching back is one click. */}
      {aiEnabled && !showHistory && !supportDraft?.active && fallbackConsent && onRevokeFallback ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            fontSize: 11,
            borderTop: '1px solid var(--border, #e4e4e7)',
            background: 'var(--muted, #f4f4f5)',
          }}
        >
          <span style={{ flex: 1, minWidth: 0, opacity: 0.85 }}>
            Using your model{fallbackLabel ? ` (${fallbackLabel})` : ''} when the free assistant is busy.
          </span>
          <button
            type="button"
            onClick={onRevokeFallback}
            style={{
              flexShrink: 0,
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid var(--border, #d4d4d8)',
              background: 'var(--background, #fff)',
              color: 'inherit',
              font: '600 11px/1.2 system-ui, sans-serif',
              cursor: 'pointer',
            }}
          >
            Stop using my model
          </button>
        </div>
      ) : null}

      {/* Chat composer — only when the AI surface is enabled (and the history
          browser isn't covering the thread it would send into). */}
      {aiEnabled && !showHistory && !supportDraft?.active ? (
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            gap: 8,
            padding: 12,
            borderTop: '1px solid var(--border, #e4e4e7)',
          }}
        >
          <input
            type="text"
            aria-label="Ask the help assistant"
            placeholder="Ask a question…"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--border, #d4d4d8)',
              background: 'var(--background, #fff)',
              color: 'inherit',
              font: 'inherit',
            }}
          />
          <button
            type="submit"
            disabled={busy || draft.trim().length === 0}
            style={{
              flexShrink: 0,
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--primary, #2563eb)',
              color: 'var(--primary-foreground, #fff)',
              font: '600 13px/1.2 system-ui, sans-serif',
              cursor: busy ? 'default' : 'pointer',
              opacity: busy || draft.trim().length === 0 ? 0.6 : 1,
            }}
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </form>
      ) : null}
    </section>
  );
}
