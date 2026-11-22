import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantHistoryTurn, AssistantPromptContext, AssistantRunner, DispatchTool } from '../core/adapters';
import { createBrowserDispatch } from '../core/browser-dispatch';
import type { HelpAnalyticsEvent, OnHelpAnalytics } from '../core/events';
import {
  type ConversationSummary,
  createIndexedDbHistoryStore,
  type HelpHistoryStore,
  type HelpMessage,
} from '../core/history';
import { resolveTargets } from '../core/resolveTargets';
import { selectTopFaq } from '../core/selectTopFaq';
import type { HelpContent } from '../core/types';
import { validateVideoSrc } from '../core/validateVideoSrc';
import { browserLocale } from '../core/video-language';
import { HelpLauncher } from './HelpLauncher';
import { HelpPanel, type HelpPanelProps } from './HelpPanel';
import type { HelpTourStep } from './HelpTour';
import { HighlightOverlay } from './HighlightOverlay';
import { HelpContext, type HelpContextValue } from './context';
import { useFirstVisitAutoOpen } from './useFirstVisitAutoOpen';
import { useHelpHotkey } from './useHelpHotkey';
import { useHighlightState } from './useHighlightState';
import { useInactivityTimeout } from './useInactivityTimeout';
import { useIsMobile } from './useIsMobile';
import { usePipWindow } from './usePipWindow';

// The PiP player (react-rnd; the YouTube embed is PipPlayer's own <iframe>,
// not a library) and the tour engine (react-joyride)
// are the package's heaviest dependencies and are only needed once a user opens a
// video or starts a tour — lazy-load them so a host that mounts help with the flag
// off (or never opens a video/tour) never pays for those bundles (ADR-089 §G13).
const PipPlayer = lazy(() => import('./PipPlayer').then((m) => ({ default: m.PipPlayer })));
const HelpTour = lazy(() => import('./HelpTour').then((m) => ({ default: m.HelpTour })));

// The container that wires the universal help system into a host app (ADR-089).
//
// It owns the help state (open / highlight / video / tour / conversation), maps
// the assistant's READ-ONLY tool calls onto those controllers via the
// browser-dispatch bridge, and renders the launcher + non-modal panel + spotlight
// overlay + PiP player + guided tour. Everything app-specific is injected, so the
// package stays universal. No writes ever leave this component.

const DEFAULT_INACTIVITY_MS = 5 * 60 * 1000;

/** A registry of guided tours keyed by tour id (authored by the host). */
export type HelpTourRegistry = Record<string, HelpTourStep[]>;

export interface HelpProviderProps {
  supportDraft?: HelpPanelProps['supportDraft'];
  /** The host's help content registry (from `defineHelpContent`). */
  content: HelpContent;
  /** The current page/tab key (the host resolves this from its router). */
  pageKey: string;

  /** Master switch (`help-system-enabled`). Default true — a host opts in by mounting. */
  enabled?: boolean;
  /** AI chat switch (`help-system-ai-enabled`). Chat needs this AND a `runner`. Default false. */
  aiEnabled?: boolean;
  /** The injectable agent backend. Without it the chat is hidden (FAQ/tours still work). */
  runner?: AssistantRunner;

  /** Boolean feature-flag resolver for FAQ item gating (need not be reactive). */
  featureFlag?: (key: string) => boolean;
  /** A/B variant resolver for FAQ experiment gating. */
  getVariant?: (key: string) => string | undefined;
  /** "Most-asked" popularity signal feeding FAQ top-N ranking. */
  faqPopularity?: Record<string, number>;
  /** The user's language — the assistant answers in it (runtime translation). */
  locale?: string;

  /** Guided tours keyed by tour id. A tour shows on a page when its id is `pageKey` or `pageKey/*`. */
  tours?: HelpTourRegistry;

  /** Analytics sink (host routes to observability). */
  onAnalytics?: OnHelpAnalytics;
  /** Milestone sink (host routes to `emitMilestone`). */
  onMilestone?: (name: string, meta?: Record<string, unknown>) => void;
  /** Change the host's current view (read-only — never mutates data). */
  navigate?: (pageKey: string) => void | Promise<void>;
  /** Read-only verification that the user completed an action (never mutates). */
  verifyCheck?: (checkId: string) => boolean | Promise<boolean>;
  /**
   * The check-id catalog `verifyCheck` understands (id + human label). Ride into
   * the assistant's prompt so `verify_step` is only ever called with a real id —
   * an unknown id just reads as "not done" and stalls multi-step guidance.
   */
  verifyChecks?: Array<{ checkId: string; label: string }>;
  /** Host sink for answer feedback 👍/👎 (§G3) — feeds the authoring "needs improvement" queue. */
  onFeedback?: (input: { messageId: string; rating: 'up' | 'down' }) => void;
  /**
   * Host sink for human-support escalation (§G4) — wire it to open a ticket/chat.
   * Providing it also enables the panel's auto-surfaced "Contact support" button.
   * `reason` is the provider's best-effort cause: `quota` / `busy` / `error`
   * (last answer), `no_result` (the last local search found nothing), or `manual`.
   */
  onEscalateSupport?: (payload: { pageKey?: string; reason: string }) => void;

  /** Activation controls. */
  activation?: { fab?: boolean; hotkey?: string | false; autoOpenFirstVisit?: boolean };
  /** Lifecycle controls. */
  lifecycle?: { closeOnEsc?: boolean; inactivityTimeoutMs?: number | false };

  /** Local history store. Defaults to an IndexedDB-backed store (memory fallback). */
  historyStore?: HelpHistoryStore;

  children?: ReactNode;
}

// Monotonic message-id generator — unique within a session, no crypto dependency.
let messageSeq = 0;
function nextMessageId(): string {
  return `m${Date.now().toString(36)}-${(messageSeq++).toString(36)}`;
}

/** Stable, non-cryptographic hash of a query for privacy-preserving analytics (djb2). */
function hashQuery(text: string): string {
  let hash = 5381;
  const normalized = text.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 33) ^ normalized.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function HelpProvider({
  supportDraft,
  content,
  pageKey,
  enabled = true,
  aiEnabled = false,
  runner,
  featureFlag,
  getVariant,
  faqPopularity,
  locale = browserLocale(),
  tours,
  onAnalytics,
  onMilestone,
  navigate,
  verifyCheck,
  verifyChecks,
  onFeedback,
  onEscalateSupport,
  activation,
  lifecycle,
  historyStore: providedStore,
  children,
}: HelpProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  // Past conversations (the history browser), newest first. Refreshed whenever the
  // archive changes (archive on "New", open, delete).
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  // Per-SESSION consent to answer through the host's paid fallback model when
  // the free path is busy (resets on reload). Reactive state — the panel shows
  // a persistent "using your model" strip with a revoke control while granted.
  const [fallbackConsent, setFallbackConsent] = useState(false);
  const fallbackConsentRef = useRef(fallbackConsent);
  fallbackConsentRef.current = fallbackConsent;
  // Label of the consented fallback model (shown in the revoke strip).
  const [fallbackLabel, setFallbackLabel] = useState<string | null>(null);
  const { highlight, setHighlight, clearHighlight } = useHighlightState();
  const pip = usePipWindow();
  const { openVideo: openPipVideo, close: closePip } = pip;
  const isMobile = useIsMobile();

  const chatEnabled = aiEnabled && !!runner;

  // The default history store is created once; a host may inject its own.
  const historyStore = useMemo(() => providedStore ?? createIndexedDbHistoryStore(), [providedStore]);

  // Host callbacks read through a ref so handler identities stay stable (no
  // re-binding listeners / re-memoizing dispatch when only a callback changes).
  const callbacks = useRef({ onAnalytics, onMilestone, navigate, verifyCheck, onFeedback, onEscalateSupport });
  callbacks.current = { onAnalytics, onMilestone, navigate, verifyCheck, onFeedback, onEscalateSupport };

  // Result count of the most recent §G2 local search — lets support escalation
  // attribute a `no_result` reason without the panel having to pass one.
  const lastSearchResultRef = useRef<number | null>(null);

  // Live values the stable handlers need to read without going stale.
  const pageKeyRef = useRef(pageKey);
  pageKeyRef.current = pageKey;
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const runnerRef = useRef(runner);
  runnerRef.current = runner;
  const historyRef = useRef(historyStore);
  historyRef.current = historyStore;
  // The live conversation, read by stable callbacks (sendMessage builds the
  // replayed history from it; escalateSupport reads the last answer's status).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // Inputs for the assistant's page-grounding prompt context, read in sendMessage.
  const promptInputsRef = useRef({ content, featureFlag, getVariant, faqPopularity, tours, verifyChecks });
  promptInputsRef.current = { content, featureFlag, getVariant, faqPopularity, tours, verifyChecks };

  const emit = useCallback((event: HelpAnalyticsEvent) => callbacks.current.onAnalytics?.(event), []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => {
    if (activeTourId) {
      setActiveTourId(null);
      setIsOpen(true);
    } else setIsOpen((prev) => !prev);
  }, [activeTourId]);

  // Fire help.opened once per open transition (kept out of the state updater so
  // it isn't double-invoked under StrictMode).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      emit({ type: 'help.opened', pageKey });
      callbacks.current.onMilestone?.('help.opened');
    }
    wasOpen.current = isOpen;
  }, [isOpen, pageKey, emit]);

  const openVideoById = useCallback(
    (videoId: string) => {
      const entry = content.videos?.[videoId];
      if (!entry) return;
      openPipVideo({
        youtubeId: entry.youtubeId,
        title: entry.title,
        startSeconds: entry.startSeconds,
        captionTrack: entry.captionTrack,
      });
      emit({ type: 'help.video.played', pageKey: pageKeyRef.current, videoId, locale: localeRef.current });
    },
    [content.videos, openPipVideo, emit],
  );

  /** Build the page-grounding prompt context from the live inputs (shared by
   *  sendMessage and the fallback retry so both runs are identically grounded). */
  const buildPromptContext = useCallback((targetPage?: string): AssistantPromptContext => {
    const currentPageKey = targetPage ?? pageKeyRef.current;
    // Build the page-grounding context the runner stamps into the system prompt.
    const {
      content: c,
      featureFlag: ff,
      getVariant: gv,
      faqPopularity: pop,
      tours: tourRegistry,
      verifyChecks: checks,
    } = promptInputsRef.current;
    const pageContent = c.pages[currentPageKey];
    // ALL tours, current page's first — the model must see the EXACT ids or
    // `start_tour` can only ever guess, and an unknown id is a silent no-op.
    // A tour's page key is its id up to the first `/` (a tour shows on the page
    // whose key matches `pageKey` or `pageKey/*`); carrying it lets the model
    // `navigate` there first and then start the tour (cross-page guidance).
    const isOnCurrentPage = (id: string) => id === currentPageKey || id.startsWith(`${currentPageKey}/`);
    const allTours = Object.entries(tourRegistry ?? {})
      .map(([id, steps]) => ({ tourId: id, label: steps[0]?.title ?? id, pageKey: id.split('/')[0] }))
      .sort((a, b) => Number(isOnCurrentPage(b.tourId)) - Number(isOnCurrentPage(a.tourId)));
    // Every page the `navigate` tool accepts, by its exact (case-sensitive) key.
    const pages = Object.entries(c.pages).map(([key, page]) => ({
      pageKey: key,
      label: page.pageLabel ?? key,
      summary: page.aiContext?.systemPromptAppendix,
    }));
    const promptContext: AssistantPromptContext = {
      pageLabel: pageContent?.pageLabel ?? currentPageKey,
      locale: localeRef.current,
      highlightables: pageContent?.highlightables,
      tours: allTours,
      pages,
      checks,
      faqDigest: selectTopFaq(pageContent?.faq ?? [], { featureFlag: ff, getVariant: gv, popularity: pop }).map(
        (f) => ({
          question: f.question,
          answer: f.answer,
        }),
      ),
      pageContextAppendix: pageContent?.aiContext?.systemPromptAppendix,
      materials: pageContent?.aiContext?.materials,
    };
    return promptContext;
  }, []);

  const startTour = useCallback((tourId: string) => setActiveTourId(tourId), []);
  const endTour = useCallback(() => setActiveTourId(null), []);

  // The read-only tool bridge: the assistant's tool calls drive UI controllers.
  const dispatch: DispatchTool = useMemo(
    () =>
      createBrowserDispatch({
        highlight_region: ({ helpIds, label, intent }) => {
          setHighlight({ helpIds, label, intent });
          emit({ type: 'help.highlight', helpIds });
        },
        clear_highlight: () => clearHighlight(),
        scroll_to: ({ helpId }) => {
          resolveTargets([helpId])[0]?.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        },
        start_tour: ({ tourId }) => {
          if (!promptInputsRef.current.tours?.[tourId]?.length) return false;
          setActiveTourId(tourId);
        },
        open_help_video: ({ videoId, src, startSeconds }) => {
          const source = validateVideoSrc(src ?? videoId ?? '');
          const entry =
            (videoId ? content.videos?.[videoId] : undefined) ??
            (source.ok
              ? Object.values(content.videos ?? {}).find((video) => video.youtubeId === source.video.videoId)
              : undefined);
          openPipVideo({
            youtubeId: entry?.youtubeId ?? videoId,
            src,
            title: entry?.title,
            captionTrack: entry?.captionTrack,
            startSeconds: startSeconds ?? entry?.startSeconds,
          });
          emit({
            type: 'help.video.played',
            pageKey: pageKeyRef.current,
            videoId: videoId ?? src ?? '',
            locale: localeRef.current,
          });
        },
        navigate: async ({ pageKey: target }) => {
          if (!Object.hasOwn(promptInputsRef.current.content.pages, target) || !callbacks.current.navigate)
            return false;
          await callbacks.current.navigate(target);
          return buildPromptContext(target);
        },
        verify_step: ({ checkId }) => callbacks.current.verifyCheck?.(checkId) ?? false,
      }),
    [content.videos, setHighlight, clearHighlight, openPipVideo, emit, buildPromptContext],
  );
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // Restore the prior conversation on mount so a reload resumes where the user
  // left off — history is local-only (ADR-089) and was already persisted per turn.
  // Runs once; only hydrates an empty thread so it never clobbers a message added
  // before the async load resolves.
  useEffect(() => {
    let cancelled = false;
    void historyRef.current.loadMessages().then((restored) => {
      if (cancelled || restored.length === 0) return;
      setMessages((prev) => (prev.length === 0 ? restored : prev));
    });
    // Populate the history browser with any previously-archived conversations.
    // Skip the update when the archive is empty — state already starts [] and a
    // redundant async setState would only trip the act() guard in host tests.
    void historyRef.current.listConversations().then((list) => {
      if (cancelled || list.length === 0) return;
      setConversations(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Start a fresh thread: archive the current one (so it's recoverable from the
  // history browser, not deleted) and refresh the list. Empty threads archive to
  // nothing. Analytics records how many turns were set aside.
  const newConversation = useCallback(async () => {
    callbacks.current.onAnalytics?.({
      type: 'help.ai.new_conversation',
      pageKey: pageKeyRef.current,
      clearedCount: messagesRef.current.length,
    });
    await historyRef.current.archiveCurrent();
    setMessages([]);
    setConversations(await historyRef.current.listConversations());
  }, []);

  // Reopen an archived conversation: archive whatever is active first (never lose
  // it), then load the chosen one as the active thread and refresh the list.
  const openConversation = useCallback(async (id: string) => {
    await historyRef.current.archiveCurrent();
    const restored = await historyRef.current.openConversation(id);
    setMessages(restored);
    setConversations(await historyRef.current.listConversations());
    callbacks.current.onAnalytics?.({
      type: 'help.ai.open_conversation',
      pageKey: pageKeyRef.current,
      messageCount: restored.length,
    });
  }, []);

  // Permanently drop an archived conversation from the history browser.
  const deleteConversation = useCallback(async (id: string) => {
    await historyRef.current.deleteConversation(id);
    setConversations(await historyRef.current.listConversations());
  }, []);

  /** Run one assistant turn and append (or substitute) the answer message. */
  const runAssistantTurn = useCallback(
    async (input: {
      message: string;
      history: AssistantHistoryTurn[];
      allowFallback: boolean;
      /** When set, this message id is replaced by the new answer (fallback retry). */
      replaceMessageId?: string;
    }) => {
      if (!runnerRef.current) return;
      setBusy(true);
      try {
        const result = await runnerRef.current({
          message: input.message,
          history: input.history,
          dispatchTool: dispatchRef.current,
          context: buildPromptContext(),
          allowFallback: input.allowFallback,
        });
        const assistantMsg: HelpMessage = {
          id: nextMessageId(),
          role: 'assistant',
          text: result.text ?? '',
          status: result.status,
          // §G5: carry the runner's source chips + confidence onto the message so the
          // panel can render them. Expand-only — a runner that omits them leaves them
          // undefined and the panel renders nothing extra.
          sources: result.sources,
          confidence: result.confidence,
          // Fallback offer on a busy answer — the panel renders the consent prompt.
          fallback: result.fallback,
        };
        setMessages((prev) =>
          input.replaceMessageId
            ? prev.map((m) => (m.id === input.replaceMessageId ? assistantMsg : m))
            : [...prev, assistantMsg],
        );
        void historyRef.current.appendMessage(assistantMsg);
      } catch {
        // Degrade gracefully — the FAQ/tours stay available (CLAUDE.md safe fallback).
        setMessages((prev) => [...prev, { id: nextMessageId(), role: 'assistant', text: '', status: 'error' }]);
      } finally {
        setBusy(false);
      }
    },
    [buildPromptContext],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !runnerRef.current) return;

      // Replay the conversation so far so the assistant answers in context (ADR-089),
      // not in isolation. Snapshot BEFORE appending this turn; drop empty/failed
      // placeholders (error/quota/busy answers carry no text) so they never pollute context.
      const history = messagesRef.current
        .filter((m) => m.text.trim().length > 0 && m.status !== 'error' && m.status !== 'quota' && m.status !== 'busy')
        .map((m) => ({ role: m.role, text: m.text }));

      const userMsg: HelpMessage = { id: nextMessageId(), role: 'user', text: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      void historyRef.current.appendMessage(userMsg);
      callbacks.current.onAnalytics?.({
        type: 'help.ai.question',
        pageKey: pageKeyRef.current,
        queryHash: hashQuery(trimmed),
        locale: localeRef.current,
      });

      await runAssistantTurn({ message: trimmed, history, allowFallback: fallbackConsentRef.current });
    },
    [runAssistantTurn],
  );

  /** The user accepted the fallback offer on a busy answer: grant SESSION consent
   *  and re-run the last question through the fallback, replacing the busy
   *  placeholder. Consent stays granted (auto-fallback on later busy turns)
   *  until revoked via {@link revokeFallbackConsent} or a reload. */
  const acceptFallback = useCallback(async () => {
    const msgs = messagesRef.current;
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setFallbackConsent(true);
    const offered = [...msgs].reverse().find((m) => m.role === 'assistant' && m.status === 'busy');
    setFallbackLabel(offered?.fallback?.label ?? null);
    emit({ type: 'help.ai.fallback_consent', pageKey: pageKeyRef.current, granted: true });
    const idx = msgs.lastIndexOf(lastUser);
    const history = msgs
      .slice(0, idx)
      .filter((m) => m.text.trim().length > 0 && m.status !== 'error' && m.status !== 'quota' && m.status !== 'busy')
      .map((m) => ({ role: m.role, text: m.text }));
    // Replace the trailing busy placeholder (if any) with the retried answer.
    const trailingBusy = [...msgs].reverse().find((m) => m.role === 'assistant' && m.status === 'busy');
    await runAssistantTurn({
      message: lastUser.text,
      history,
      allowFallback: true,
      replaceMessageId: trailingBusy?.id,
    });
  }, [emit, runAssistantTurn]);

  /** The chat's "stop using my model" control — revoke the session consent so
   *  later questions go back to the free path (and re-offer on busy). */
  const revokeFallbackConsent = useCallback(() => {
    setFallbackConsent(false);
    setFallbackLabel(null);
    emit({ type: 'help.ai.fallback_consent', pageKey: pageKeyRef.current, granted: false });
  }, [emit]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    void historyRef.current.clear();
  }, []);

  // §G2: the panel ran a local search before deciding whether to spend tokens.
  // Record the count (for `no_result` attribution) and emit the analytics event.
  const searchPerformed = useCallback(
    (_query: string, resultCount: number) => {
      lastSearchResultRef.current = resultCount;
      emit({ type: 'help.search.performed', pageKey: pageKeyRef.current, resultCount });
    },
    [emit],
  );

  // §G4: the user asked for a human. Attribute a best-effort reason from the last
  // assistant answer (quota/error) or the last local search (no_result), emit the
  // analytics event, and forward to the host sink so it can open a ticket/chat.
  const escalateSupport = useCallback(() => {
    const lastAssistant = [...messagesRef.current].reverse().find((m) => m.role === 'assistant');
    const reason =
      lastAssistant?.status === 'quota'
        ? 'quota'
        : lastAssistant?.status === 'busy'
          ? 'busy'
          : lastAssistant?.status === 'error'
            ? 'error'
            : lastAssistant?.confidence === 'low'
              ? 'low_confidence'
              : lastSearchResultRef.current === 0
                ? 'no_result'
                : 'manual';
    emit({ type: 'help.support.escalated', pageKey: pageKeyRef.current, reason });
    callbacks.current.onEscalateSupport?.({ pageKey: pageKeyRef.current, reason });
  }, [emit]);

  // --- Activation: hotkey + first-visit auto-open ----------------------------
  useHelpHotkey({ hotkey: activation?.hotkey, onToggle: toggle, enabled });
  useFirstVisitAutoOpen({
    pageKey,
    enabled: enabled && activation?.autoOpenFirstVisit === true,
    store: historyStore,
    onAutoOpen: open,
  });

  // --- Lifecycle: inactivity timeout -----------------------------------------
  const { notifyActivity } = useInactivityTimeout({
    timeoutMs: lifecycle?.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_MS,
    active: isOpen,
    onTimeout: close,
  });

  // --- Lifecycle: layered ESC (overlay → PiP → tour → panel) -----------------
  const layerRefs = useRef({ highlight, pipVideo: pip.video, activeTourId, isOpen });
  layerRefs.current = { highlight, pipVideo: pip.video, activeTourId, isOpen };
  useEffect(() => {
    if (lifecycle?.closeOnEsc === false) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const layers = layerRefs.current;
      if (layers.highlight) {
        clearHighlight();
      } else if (layers.pipVideo) {
        closePip();
      } else if (layers.activeTourId) {
        setActiveTourId(null);
      } else if (layers.isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lifecycle?.closeOnEsc, clearHighlight, closePip]);

  // --- Derived view data ------------------------------------------------------
  const pageContent = content.pages[pageKey];
  const pageLabel = pageContent?.pageLabel ?? pageKey;
  const faq = pageContent?.faq ?? [];
  const panelVisible = isOpen && !(activeTourId && tours?.[activeTourId]?.length);
  const pageTourIds = useMemo(
    () => (tours ? Object.keys(tours).filter((id) => id === pageKey || id.startsWith(`${pageKey}/`)) : []),
    [tours, pageKey],
  );

  const value: HelpContextValue = {
    enabled,
    aiEnabled: chatEnabled,
    pageKey,
    pageContent,
    isOpen,
    open,
    close,
    toggle,
    messages,
    sendMessage,
    busy,
    clearHistory,
    conversations,
    newConversation,
    openConversation,
    deleteConversation,
    highlight,
    clearHighlight,
    openVideo: pip.openVideo,
    activeTourId,
    startTour,
    endTour,
    emit,
  };

  return (
    <HelpContext.Provider value={value}>
      {children}
      {enabled ? (
        <>
          {activation?.fab !== false ? <HelpLauncher isOpen={panelVisible} onClick={toggle} /> : null}
          {isOpen ? (
            // Capture pointer/key activity to reset the inactivity timer.
            <div hidden={!panelVisible} onPointerDownCapture={notifyActivity} onKeyDownCapture={notifyActivity}>
              <HelpPanel
                supportDraft={supportDraft}
                pageKey={pageKey}
                pageLabel={pageLabel}
                faq={faq}
                videos={content.videos}
                featureFlag={featureFlag}
                getVariant={getVariant}
                popularity={faqPopularity}
                onOpenFaq={(faqId) => emit({ type: 'help.faq.opened', pageKey, faqId, locale })}
                onWatchVideo={openVideoById}
                tourIds={pageTourIds}
                onStartTour={startTour}
                aiEnabled={chatEnabled}
                messages={messages}
                onSend={sendMessage}
                onNewConversation={newConversation}
                conversations={conversations}
                onOpenConversation={openConversation}
                onDeleteConversation={deleteConversation}
                onSearch={searchPerformed}
                onFeedback={(f) => {
                  emit({ type: 'help.ai.answer_feedback', pageKey, rating: f.rating });
                  callbacks.current.onFeedback?.(f);
                }}
                onEscalateSupport={onEscalateSupport ? escalateSupport : undefined}
                fallbackConsent={fallbackConsent}
                fallbackLabel={fallbackLabel}
                onAcceptFallback={acceptFallback}
                onRevokeFallback={revokeFallbackConsent}
                busy={busy}
                variant={isMobile ? 'bottom-sheet' : 'side'}
                onClose={close}
              />
            </div>
          ) : null}
          {highlight ? (
            <HighlightOverlay
              helpIds={highlight.helpIds}
              label={highlight.label}
              intent={highlight.intent}
              onClear={clearHighlight}
            />
          ) : null}
          {pip.video ? (
            // Lazy chunk — `null` fallback keeps the (visual-only) player from
            // flashing a spinner while react-rnd loads. PipPlayer owns its
            // YouTube <iframe> directly (no react-youtube) so it can carry the
            // `credentialless` attribute COEP requires (ADR-275 D11).
            <Suspense fallback={null}>
              <PipPlayer
                youtubeId={pip.video.youtubeId}
                src={pip.video.src}
                captionTrack={pip.video.captionTrack}
                locale={locale}
                title={pip.video.title}
                startSeconds={pip.video.startSeconds}
                onClose={pip.close}
              />
            </Suspense>
          ) : null}
          {activeTourId && tours?.[activeTourId] ? (
            <Suspense fallback={null}>
              <HelpTour
                steps={tours[activeTourId]}
                run
                onFinish={() => {
                  setActiveTourId(null);
                  emit({ type: 'help.tour.completed', tourId: activeTourId });
                  callbacks.current.onMilestone?.('help.tour.completed', { tourId: activeTourId });
                }}
                onSkip={endTour}
              />
            </Suspense>
          ) : null}
        </>
      ) : null}
    </HelpContext.Provider>
  );
}
