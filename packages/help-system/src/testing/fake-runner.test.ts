// @module-tag dom
import { describe, expect, it, vi } from 'vitest';
import { createBrowserDispatch } from '../core/browser-dispatch';
import { createFakeAssistantRunner } from './fake-runner';

describe('createFakeAssistantRunner', () => {
  it('drives the dispatch bridge with scripted tool calls (AI-drives-frontend-tools, no LLM)', async () => {
    // The dispatch verifies targets resolve on the page before highlighting.
    document.body.innerHTML = '<button data-help-id="scout.run-button">Run</button>';
    const highlight = vi.fn();
    const dispatch = createBrowserDispatch({ highlight_region: highlight });
    const runner = createFakeAssistantRunner({
      toolCalls: [{ name: 'highlight_region', input: { help_ids: ['scout.run-button'], label: 'Run Scout' } }],
      answer: 'Click Run Scout.',
    });

    const result = await runner({ message: 'how do I run scout?', dispatchTool: dispatch });

    expect(highlight).toHaveBeenCalledWith({ helpIds: ['scout.run-button'], label: 'Run Scout', intent: undefined });
    expect(result).toEqual({ status: 'ok', text: 'Click Run Scout.' });
  });

  it('supports a per-message script and a quota status', async () => {
    const dispatch = createBrowserDispatch({});
    const runner = createFakeAssistantRunner((message) =>
      message.includes('limit') ? { status: 'quota', answer: 'Daily help limit reached.' } : { answer: 'ok' },
    );
    expect((await runner({ message: 'hit the limit', dispatchTool: dispatch })).status).toBe('quota');
  });
});
