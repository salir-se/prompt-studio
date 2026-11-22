// @prompt-studio/help-system — universal in-app help & onboarding (ADR-089).
//
// Structured as core/ (framework-agnostic) + react/ + salir/ so a future split
// into `@prompt-studio/help-system-core` / `-react` / `-salir` is a folder promotion.
// Read-only by design; content is English-authored, localized at runtime.

export type {
  AssistantHistoryTurn,
  AssistantPromptContext,
  AssistantRunner,
  AssistantRunRequest,
  AssistantRunResult,
  DispatchTool,
  HelpConfidence,
  HelpSource,
} from './core/adapters';
export { type Announcement, type SelectAnnouncementsOptions, selectAnnouncements } from './core/announcements';
export { type BrowserToolHandlers, createBrowserDispatch } from './core/browser-dispatch';
export {
  type ChecklistDefinition,
  type ChecklistItem,
  type ChecklistItemProgress,
  type ChecklistProgress,
  type ChecklistRegistry,
  checklistProgress,
} from './core/checklist';
export { CMS_ASSISTANT_KEY, type CmsAssistantOverlay } from './core/cms-overlay';
export { defineHelpContent } from './core/defineHelpContent';
export type { HelpAnalyticsEvent, OnHelpAnalytics } from './core/events';
export { type FaqGateResolvers, filterFaq } from './core/filterFaq';
export { isPublished, type StaleContentEntry, type StaleReason, staleContent } from './core/governance';
export {
  type ArchivedConversation,
  type ConversationSummary,
  createIndexedDbHistoryStore,
  createMemoryHistoryStore,
  type HelpHistoryStore,
  type HelpMessage,
} from './core/history';
export { detectPipEmbedMode, type PipEmbedMode, type PipEmbedModeInput, pipEmbedMode } from './core/pip-embed-mode';
export { mergeHelpContent, parseRemoteHelpPayload, type RemoteHelpPayload } from './core/remoteContent';
export { missingTargets, type ResolvedTarget, resolveTargets } from './core/resolveTargets';
export {
  type ResourceCenterConfig,
  type ResourceCenterSection,
  type ResourceCenterSectionType,
  resolveResourceCenterSections,
} from './core/resourceCenter';
export { type SelectTopFaqOptions, selectTopFaq } from './core/selectTopFaq';
export {
  collectDomHelpIdCounts,
  type ScanHelpTargetsInput,
  scanHelpTargets,
  type TargetIssue,
  type TargetIssueKind,
} from './core/targetScanner';
export {
  type HelpTourContext,
  type HelpTourFallback,
  type HelpTourStep,
  helpIdSelector,
  type PlannedJoyrideStep,
  planTour,
  type TourDirective,
  type TourFallbackAction,
  type TourPlan,
  type TourPlanEvent,
} from './core/tour';
export {
  createMemoryTranslationStore,
  createTranslationCache,
  type TranslationCache,
  type TranslationKeyParts,
  type TranslationStore,
  type Translator,
  translationCacheKey,
} from './core/translationCache';
export type {
  ContentMeta,
  ContentStatus,
  FaqItem,
  HelpAiContext,
  HelpContent,
  HelpPageContent,
  HighlightableDescriptor,
  VideoEntry,
  VideoRegistry,
} from './core/types';
export { type ValidatedVideo, type ValidateVideoResult, validateVideoSrc } from './core/validateVideoSrc';
export { Announcements, type AnnouncementsProps } from './react/Announcements';
export { Checklist, type ChecklistProps } from './react/Checklist';
export type { HelpContextValue } from './react/context';
export { FaqAccordion, type FaqAccordionProps } from './react/FaqAccordion';
export { FaqVideoPreview, type FaqVideoPreviewProps } from './react/FaqVideoPreview';
export { HelpDebugReport, type HelpDebugReportProps } from './react/HelpDebugReport';
export { HelpLauncher, type HelpLauncherProps } from './react/HelpLauncher';
export { HelpPanel, type HelpPanelProps } from './react/HelpPanel';
export { HelpProvider, type HelpProviderProps, type HelpTourRegistry } from './react/HelpProvider';
export { HelpTour, type HelpTourProps } from './react/HelpTour';
export { HighlightOverlay, type HighlightOverlayProps } from './react/HighlightOverlay';
export { Markdown, type MarkdownProps } from './react/Markdown';
export { PipPlayer, type PipPlayerProps } from './react/PipPlayer';
export { ResourceCenter, type ResourceCenterProps } from './react/ResourceCenter';
export { ThinkingIndicator } from './react/ThinkingIndicator';
export { type UseFirstVisitAutoOpenOptions, useFirstVisitAutoOpen } from './react/useFirstVisitAutoOpen';
export { useHelp } from './react/useHelp';
export { type UseHelpHotkeyOptions, useHelpHotkey } from './react/useHelpHotkey';
export { type HighlightController, type HighlightRequest, useHighlightState } from './react/useHighlightState';
export {
  type InactivityController,
  type UseInactivityTimeoutOptions,
  useInactivityTimeout,
} from './react/useInactivityTimeout';
export { useIsMobile } from './react/useIsMobile';
export { type PipVideoRequest, type PipWindowController, usePipWindow } from './react/usePipWindow';
export { type UseRemoteHelpContentOptions, useRemoteHelpContent } from './react/useRemoteHelpContent';
export { createFakeAssistantRunner, type FakeScript, type FakeToolCall } from './testing/fake-runner';
