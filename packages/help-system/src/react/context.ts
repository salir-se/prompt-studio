// React context for the help system (ADR-089).
//
// `HelpProvider` builds this value and `useHelp` reads it. Kept in its own module
// so the provider and the hook don't import each other (avoids a cycle). The
// value is the full read-only surface a host UI drives the panel with: open
// state, the current page's content, the conversation seam, and the UI-effect
// controllers (highlight / video / tour) the assistant's tools resolve against.

import { createContext } from 'react';
import type { HelpAnalyticsEvent } from '../core/events';
import type { ConversationSummary, HelpMessage } from '../core/history';
import type { HelpPageContent } from '../core/types';
import type { HighlightRequest } from './useHighlightState';
import type { PipVideoRequest } from './usePipWindow';

export interface HelpContextValue {
  /** Master switch — when false all help UI is hidden (`help-system-enabled` off). */
  enabled: boolean;
  /** Whether the AI chat surface is available (`help-system-ai-enabled` AND a runner is injected). */
  aiEnabled: boolean;

  /** The current page/tab key (drives FAQ selection + assistant grounding). */
  pageKey: string;
  /** Resolved help content for the current page, or `undefined` if the page has none. */
  pageContent: HelpPageContent | undefined;

  /** Whether the help panel is open. */
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;

  /** The current conversation (Phase 4 renders the rich chat; the seam exists now). */
  messages: HelpMessage[];
  /** Send a user message to the assistant runner; its tool calls drive the UI controllers. */
  sendMessage: (text: string) => Promise<void>;
  /** Whether a `sendMessage` is in flight. */
  busy: boolean;
  /** Wipe local history (active messages + archived conversations + first-visit "seen" flags). */
  clearHistory: () => void;
  /** Past conversations for the history browser, newest first (summaries only). */
  conversations: ConversationSummary[];
  /** Archive the active thread (recoverable) and start an empty one — the "New" action. */
  newConversation: () => Promise<void>;
  /** Reopen an archived conversation as the active thread (archives the current one first). */
  openConversation: (id: string) => Promise<void>;
  /** Permanently remove an archived conversation from the history browser. */
  deleteConversation: (id: string) => Promise<void>;

  /** The active spotlight request, or `null`. */
  highlight: HighlightRequest | null;
  /** Clear any active spotlight. */
  clearHighlight: () => void;

  /** Open a tutorial video in the floating PiP player. */
  openVideo: (video: PipVideoRequest) => void;

  /** The id of the running guided tour, or `null`. */
  activeTourId: string | null;
  startTour: (tourId: string) => void;
  endTour: () => void;

  /** Emit a help analytics event (the host routes it to the observability sink). */
  emit: (event: HelpAnalyticsEvent) => void;
}

/** Null until a {@link HelpProvider} supplies the value — `useHelp` throws otherwise. */
export const HelpContext = createContext<HelpContextValue | null>(null);
