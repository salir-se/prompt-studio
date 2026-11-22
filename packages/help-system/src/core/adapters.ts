// Adapter interfaces for @prompt-studio/help-system (ADR-089).
//
// These are injected by the host so the package stays universal: the agent
// runner, the tool-dispatch seam, and (elsewhere) the history store / verify
// check. No React, no `@prompt-studio/*` — part of the future `-core` split.

/** The seam `runAgent()` calls for every `tool_use` block. */
export type DispatchTool = (name: string, input: unknown, signal?: AbortSignal) => Promise<unknown>;

/**
 * Page-grounding the host supplies so the runner can build the assistant's
 * system prompt (current page, highlightable controls, the curated FAQ, and
 * extra materials). All English-authored; the assistant answers in `locale`.
 */
export interface AssistantPromptContext {
  /** Explicit report intake; tools may edit the local review draft, never publish it. */
  mode?: 'support';
  /** Human-readable current page/tab name. */
  pageLabel: string;
  /** The user's language — the assistant answers in it (runtime translation). */
  locale?: string;
  /** Highlightable elements on this page (the assistant references them by `helpId`). */
  highlightables?: Array<{ helpId: string; label: string; description: string }>;
  /** ALL guided tours (the assistant starts them by exact `tourId`). `pageKey`
   *  names the page a tour belongs to, so the assistant can `navigate` there
   *  first and then start it (cross-page guidance). Without this list the model
   *  cannot know a valid id — an invented id is a silent no-op in the host, so
   *  `start_tour` would never visibly trigger. */
  tours?: Array<{ tourId: string; label: string; pageKey?: string }>;
  /** All pages/tabs the `navigate` tool accepts, by exact `pageKey`. Page keys
   *  are case-sensitive join keys — without this list the model can only guess
   *  (e.g. `settings` vs `Settings`) and a wrong guess routes to the fallback.
   *  Optional authored summaries ground conceptual questions about other allowed pages. */
  pages?: Array<{ pageKey: string; label: string; summary?: string }>;
  /** The completion checks `verify_step` accepts, by exact `checkId` (the host's
   *  read-only progress predicates — e.g. the Get Started steps). Grounding these
   *  is what makes multi-step guidance work: the assistant re-checks a step after
   *  telling the user what to do, and an unknown id just reads as "not done". */
  checks?: Array<{ checkId: string; label: string }>;
  /** The curated top-N FAQ for the page (question/answer pairs), token-bounded. */
  faqDigest?: Array<{ question: string; answer: string }>;
  /** Extra grounding appended to the prompt (`aiContext.systemPromptAppendix`). */
  pageContextAppendix?: string;
  /** Reference materials (`aiContext.materials`). */
  materials?: Array<{ title: string; body: string }>;
}

/**
 * One prior conversation turn replayed to the assistant so it answers in the
 * context of the ongoing chat (ADR-089) rather than treating every question in
 * isolation. Plain `{ role, text }` by design — it must be serializable to ride
 * through the `agent:assistant` job payload (IndexedDB). Local-only: history
 * never leaves the device.
 */
export interface AssistantHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantRunRequest {
  /** Optional invocation id used to join queue, prompt-composition, and usage evidence. */
  correlationId?: string;
  /** The user's message. */
  message: string;
  /**
   * Prior conversation turns (oldest first), excluding the current {@link message}.
   * The runner prepends them to the model's message list so the answer is grounded
   * in the conversation so far. Optional and expand-only: a runner that ignores it
   * stays single-turn; the host caps the length to bound tokens.
   */
  history?: AssistantHistoryTurn[];
  /** Routes the model's tool calls (UI effects + read-only verify) into the host. */
  dispatchTool: DispatchTool;
  /**
   * The user has consented (this session) to the host's fallback model — when
   * the primary free path is busy, the runner may answer through it instead of
   * giving up. Never spend the fallback without this being true.
   */
  allowFallback?: boolean;
  signal?: AbortSignal;
  /** Page-grounding for the system prompt (filled by the host from its content). */
  context?: AssistantPromptContext;
  /**
   * #1525 (ADR-225 amendment, deferred from #1509): called once per model
   * turn that produces a reply (free path or the consented fallback), before
   * any tool dispatch for that turn. A queued `agent:assistant` job runner
   * forwards it to `QueueRunContext.heartbeat` so a long multi-turn Help
   * Assistant run that keeps replying is bounded by silence since its last
   * reply, not by total attempt time. Optional and expand-only: a direct
   * (non-queued) caller omits it.
   */
  onProgress?: () => void;
}

/**
 * A piece of grounding the assistant's answer was based on, surfaced to the user
 * as a "source chip" (ADR-089 §G5). `type` mirrors the grounding kinds the runner
 * is fed (curated FAQ, reference materials, a tour, a video, or the live page
 * context); `id`/`title` let the UI label the chip (and, later, deep-link).
 */
export interface HelpSource {
  type: 'faq' | 'material' | 'tour' | 'video' | 'page_context';
  id: string;
  title: string;
}

/** The assistant's self-reported confidence in an answer (ADR-089 §G5). `low` ⇒ never present it as authoritative. */
export type HelpConfidence = 'high' | 'medium' | 'low';

export interface AssistantRunResult {
  /** `quota` = the user's own daily help limit was hit (the panel says so).
   *  `busy` = a TRANSIENT capacity signal — the upstream model or the shared
   *  key is rate-limited right now; retrying later will work, so the panel must
   *  NOT claim a daily limit. `error` = everything else (panel suggests FAQ). */
  status: 'ok' | 'error' | 'quota' | 'busy';
  /** The assistant's text answer, in the user's language. */
  text?: string;
  /** Cost of this run in USD (0 for free models). */
  costUsd?: number;
  /**
   * What the answer was grounded in — source chips (ADR-089 §G5). Optional and
   * expand-only: a runner that doesn't populate it omits it and the panel renders
   * chips only when present. Populating this is a follow-up — the inference prompt
   * must be taught to return `sources`/`confidence`.
   */
  sources?: HelpSource[];
  /** The assistant's self-reported confidence (ADR-089 §G5). Optional; see {@link sources}. */
  confidence?: HelpConfidence;
  /**
   * Present on a `busy` result when the host has a consented-cost fallback
   * available (e.g. the workspace's own LLM). The panel renders a consent
   * prompt from it; accepting re-runs the question with `allowFallback: true`.
   * `label` names what would be used (e.g. "anthropic · claude-sonnet-4-6").
   */
  fallback?: { label: string };
}

/**
 * The injectable agent backend. Salir provides one backed by `@prompt-studio/agent`'s
 * `runAgent`; a foreign host can provide any implementation. **Read-only by
 * contract** — it may only drive UI-effect + verify tools, never mutate state.
 */
export type AssistantRunner = (request: AssistantRunRequest) => Promise<AssistantRunResult>;
