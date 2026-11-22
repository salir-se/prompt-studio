import type { AssistantRunner, HelpConfidence, HelpSource } from '../core/adapters';

export interface FakeToolCall {
  name: string;
  input?: unknown;
}

export interface FakeScript {
  /** Tool calls the fake "model" makes, in order, before answering. */
  toolCalls?: FakeToolCall[];
  /** The text answer to return. */
  answer?: string;
  status?: 'ok' | 'error' | 'quota' | 'busy';
  /** Source chips the fake answer claims to be grounded in (§G5 render seam). */
  sources?: HelpSource[];
  /** The fake answer's self-reported confidence (§G5). */
  confidence?: HelpConfidence;
}

/**
 * A scripted {@link AssistantRunner} for tests and E2E-first development
 * (CLAUDE.md "stubs/mocks/fakes"). It drives the real browser-dispatch bridge with
 * canned tool calls — so a test can assert that a `highlight_region` call actually
 * dims the screen — with no network and no LLM. Promote to the real Salir runner
 * once the UI contract holds.
 */
export function createFakeAssistantRunner(script: FakeScript | ((message: string) => FakeScript)): AssistantRunner {
  return async ({ message, dispatchTool, signal }) => {
    const s = typeof script === 'function' ? script(message) : script;
    for (const call of s.toolCalls ?? []) {
      await dispatchTool(call.name, call.input, signal);
    }
    return { status: s.status ?? 'ok', text: s.answer ?? 'Done.', sources: s.sources, confidence: s.confidence };
  };
}
