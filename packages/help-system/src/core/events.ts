// Analytics event taxonomy for @prompt-studio/help-system (ADR-089 §G14).
//
// The package emits these via the host-injected `onAnalytics`; the host routes
// them to the observability sink. They feed the "most-asked per page" read model.
// Question text is hashed (not raw) by default for privacy.

export type HelpAnalyticsEvent =
  | { type: 'help.opened'; pageKey: string }
  | { type: 'help.faq.opened'; pageKey: string; faqId: string; locale?: string }
  | { type: 'help.search.performed'; pageKey: string; resultCount: number }
  | { type: 'help.ai.question'; pageKey: string; queryHash: string; locale?: string }
  | { type: 'help.ai.new_conversation'; pageKey: string; clearedCount: number }
  | { type: 'help.ai.open_conversation'; pageKey: string; messageCount: number }
  | { type: 'help.ai.answer_feedback'; pageKey: string; faqId?: string; rating: 'up' | 'down' }
  | { type: 'help.ai.fallback_consent'; pageKey: string; granted: boolean }
  | { type: 'help.video.played'; pageKey: string; videoId: string; locale?: string }
  | { type: 'help.tour.completed'; tourId: string }
  | { type: 'help.tour.target_missing'; tourId: string; helpId: string }
  | { type: 'help.support.escalated'; pageKey: string; reason: string }
  | { type: 'help.highlight'; helpIds: string[] };

/** The host sink for analytics events (no-op by default). */
export type OnHelpAnalytics = (event: HelpAnalyticsEvent) => void;
