// @module-tag dom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AssistantHistoryTurn, AssistantRunner, AssistantRunRequest } from '../core/adapters';
import type { HelpAnalyticsEvent } from '../core/events';
import { createMemoryHistoryStore } from '../core/history';
import type { HelpContent } from '../core/types';
import { createFakeAssistantRunner } from '../testing/fake-runner';
import { HelpProvider, type HelpProviderProps } from './HelpProvider';

const content: HelpContent = {
  videos: { 'scout-intro': { youtubeId: 'dQw4w9WgXcQ', title: 'Scout intro' } },
  pages: {
    Scout: {
      pageLabel: 'Scout',
      faq: [
        { id: 'scout.what', question: 'How do I start a search?', answer: 'Click Run Scout.', videoId: 'scout-intro' },
      ],
    },
  },
};

function renderProvider(overrides: Partial<HelpProviderProps> = {}) {
  return render(<HelpProvider content={content} pageKey="Scout" {...overrides} />);
}

describe('HelpProvider', () => {
  it('renders nothing when disabled', () => {
    renderProvider({ enabled: false });
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument();
  });

  it('opens the panel from the launcher and shows the page FAQ', async () => {
    const user = userEvent.setup();
    renderProvider();
    expect(screen.queryByRole('dialog', { name: /help — scout/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('dialog', { name: /help — scout/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'How do I start a search?' })).toBeInTheDocument();
  });

  it('hides the chat composer when AI is disabled, even with a runner', async () => {
    const user = userEvent.setup();
    renderProvider({ runner: createFakeAssistantRunner({ answer: 'hi' }), aiEnabled: false });
    await user.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.queryByRole('textbox', { name: /ask the help assistant/i })).not.toBeInTheDocument();
  });

  it('drives the read-only highlight overlay from a scripted assistant tool call', async () => {
    // The dispatch verifies targets resolve on the page before highlighting.
    const target = document.createElement('button');
    target.setAttribute('data-help-id', 'scout.run');
    document.body.appendChild(target);
    const user = userEvent.setup();
    const runner = createFakeAssistantRunner({
      toolCalls: [{ name: 'highlight_region', input: { help_ids: ['scout.run'], label: 'Run Scout' } }],
      answer: 'Dimming everything except Run Scout.',
    });
    renderProvider({ runner, aiEnabled: true });

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'how do I run scout?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // The scripted tool call must have actually dimmed the screen (browser-dispatch
    // → setHighlight → overlay), and the assistant's answer must be recorded.
    await waitFor(() => expect(document.querySelector('[data-help-overlay]')).toBeInTheDocument());
    expect(screen.getByText('Dimming everything except Run Scout.')).toBeInTheDocument();
  });

  it('clears the thread and emits help.ai.new_conversation when starting a new conversation', async () => {
    const user = userEvent.setup();
    const events: HelpAnalyticsEvent[] = [];
    renderProvider({
      onAnalytics: (e) => events.push(e),
      runner: createFakeAssistantRunner({ answer: 'Head to the Scout tab to begin.' }),
      aiEnabled: true,
    });

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'zzqqxx-nomatch');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('Head to the Scout tab to begin.')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Start a new conversation' }));

    // The thread is wiped and the analytics event records how many turns were cleared.
    expect(screen.queryByText('Head to the Scout tab to begin.')).not.toBeInTheDocument();
    expect(events).toContainEqual({ type: 'help.ai.new_conversation', pageKey: 'Scout', clearedCount: 2 });
    // With the thread empty, the control hides itself again.
    expect(screen.queryByRole('button', { name: 'Start a new conversation' })).not.toBeInTheDocument();
  });

  it('archives on New and reopens the conversation from the history browser', async () => {
    const user = userEvent.setup();
    const store = createMemoryHistoryStore();
    const events: HelpAnalyticsEvent[] = [];
    renderProvider({
      historyStore: store,
      onAnalytics: (e) => events.push(e),
      runner: createFakeAssistantRunner({ answer: 'Head to the Scout tab to begin.' }),
      aiEnabled: true,
    });

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'zzqqxx-archive-me');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('Head to the Scout tab to begin.')).toBeInTheDocument());

    // "New" archives (does NOT delete) — the history clock appears.
    await user.click(screen.getByRole('button', { name: 'Start a new conversation' }));
    expect(screen.queryByText('Head to the Scout tab to begin.')).not.toBeInTheDocument();
    const clock = await screen.findByRole('button', { name: 'Past conversations' });

    // The browser lists the archived conversation, titled from the first user turn.
    await user.click(clock);
    // Anchored: the row's name starts with the title; the delete button's doesn't.
    const item = await screen.findByRole('button', { name: /^zzqqxx-archive-me/ });

    // Reopening restores the full thread and emits the open event.
    await user.click(item);
    expect(await screen.findByText('Head to the Scout tab to begin.')).toBeInTheDocument();
    expect(events).toContainEqual({ type: 'help.ai.open_conversation', pageKey: 'Scout', messageCount: 2 });
    // Reopened = no longer archived, so the empty archive hides the clock again.
    expect(screen.queryByRole('button', { name: 'Past conversations' })).not.toBeInTheDocument();
  });

  it('deletes an archived conversation from the history browser', async () => {
    const user = userEvent.setup();
    const store = createMemoryHistoryStore();
    await store.appendMessage({ id: 'm1', role: 'user', text: 'old question' });
    await store.appendMessage({ id: 'm2', role: 'assistant', text: 'old answer' });
    await store.archiveCurrent();

    renderProvider({ historyStore: store, runner: createFakeAssistantRunner({ answer: 'ok' }), aiEnabled: true });
    await user.click(screen.getByRole('button', { name: 'Help' }));

    await user.click(await screen.findByRole('button', { name: 'Past conversations' }));
    await user.click(await screen.findByRole('button', { name: /delete conversation: old question/i }));

    // The list empties and the store no longer holds the conversation.
    expect(await screen.findByText(/no saved conversations yet/i)).toBeInTheDocument();
    expect(await store.listConversations()).toEqual([]);
  });

  it('emits help.opened, help.faq.opened and help.ai.question analytics', async () => {
    const user = userEvent.setup();
    const events: HelpAnalyticsEvent[] = [];
    const onAnalytics = (e: HelpAnalyticsEvent) => events.push(e);
    renderProvider({ onAnalytics, runner: createFakeAssistantRunner({ answer: 'ok' }), aiEnabled: true });

    await user.click(screen.getByRole('button', { name: 'Help' }));
    expect(events).toContainEqual({ type: 'help.opened', pageKey: 'Scout' });

    await user.click(screen.getByRole('button', { name: 'How do I start a search?' }));
    expect(events.some((e) => e.type === 'help.faq.opened' && e.faqId === 'scout.what')).toBe(true);

    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'hello?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(events.some((e) => e.type === 'help.ai.question')).toBe(true));
    // Question text is hashed, never sent raw (privacy).
    const q = events.find((e) => e.type === 'help.ai.question');
    expect(q && 'queryHash' in q && q.queryHash).toBeTruthy();
  });

  it('fires the help.opened milestone on open', async () => {
    const user = userEvent.setup();
    const onMilestone = vi.fn();
    renderProvider({ onMilestone });
    await user.click(screen.getByRole('button', { name: 'Help' }));
    expect(onMilestone).toHaveBeenCalledWith('help.opened');
  });

  it('closes the panel on Escape (layered lifecycle)', async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('dialog', { name: /help — scout/i })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /help — scout/i })).not.toBeInTheDocument());
  });

  it('emits help.search.performed with the local-FAQ match count (§G2)', async () => {
    const user = userEvent.setup();
    const events: HelpAnalyticsEvent[] = [];
    renderProvider({
      onAnalytics: (e) => events.push(e),
      runner: createFakeAssistantRunner({ answer: 'ok' }),
      aiEnabled: true,
    });
    await user.click(screen.getByRole('button', { name: 'Help' }));
    // This query matches the page FAQ, so the assistant is deflected and a search
    // event is emitted with a non-zero count.
    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'how do I start a search');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const search = events.find((e) => e.type === 'help.search.performed');
    expect(search).toBeDefined();
    expect(search && 'resultCount' in search && search.resultCount).toBeGreaterThan(0);
  });

  it('escalates to support: emits help.support.escalated and forwards to the host (§G4)', async () => {
    const user = userEvent.setup();
    const events: HelpAnalyticsEvent[] = [];
    const onEscalateSupport = vi.fn();
    // A quota answer auto-surfaces the support button.
    renderProvider({
      onAnalytics: (e) => events.push(e),
      onEscalateSupport,
      runner: createFakeAssistantRunner({ answer: '', status: 'quota' }),
      aiEnabled: true,
    });
    await user.click(screen.getByRole('button', { name: 'Help' }));
    // A no-match question goes straight to the (quota) assistant.
    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'zzqqxx-nomatch');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: /contact support/i }));

    const escalated = events.find((e) => e.type === 'help.support.escalated');
    expect(escalated).toMatchObject({ type: 'help.support.escalated', pageKey: 'Scout' });
    expect(onEscalateSupport).toHaveBeenCalledExactlyOnceWith({ pageKey: 'Scout', reason: 'quota' });
  });

  it('hides the support button when onEscalateSupport is not provided (§G4)', async () => {
    const user = userEvent.setup();
    renderProvider({
      runner: createFakeAssistantRunner({ answer: '', status: 'error' }),
      aiEnabled: true,
    });
    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'zzqqxx-nomatch');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    // An error answer rendered, but no host sink ⇒ no support affordance.
    await screen.findByText(/assistant is unavailable/i);
    expect(screen.queryByRole('button', { name: /contact support/i })).not.toBeInTheDocument();
  });

  it('copies sources + confidence from the runner result onto the assistant message (§G5)', async () => {
    const user = userEvent.setup();
    const runner = createFakeAssistantRunner({
      answer: 'Open the Scout tab and click Run Scout.',
      confidence: 'high',
      sources: [{ type: 'faq', id: 'scout.what', title: 'Starting a search' }],
    });
    renderProvider({ runner, aiEnabled: true });
    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'zzqqxx-nomatch');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // The chip and confidence label appear only if the provider copied them through.
    const chips = await screen.findByRole('list', { name: /answer sources/i });
    expect(within(chips).getByText(/starting a search/i)).toBeInTheDocument();
    expect(screen.getByText(/high confidence/i)).toBeInTheDocument();
  });

  it('replays the prior conversation to the runner so follow-ups answer in context', async () => {
    const user = userEvent.setup();
    const seen: Array<AssistantHistoryTurn[] | undefined> = [];
    let n = 0;
    const runner: AssistantRunner = async ({ history }) => {
      seen.push(history);
      n += 1;
      return { status: 'ok', text: `reply ${n}` };
    };
    renderProvider({ runner, aiEnabled: true });

    await user.click(screen.getByRole('button', { name: 'Help' }));
    const ask = () => screen.getByRole('textbox', { name: /ask the help assistant/i });
    // No-match queries go straight to the assistant (not deflected to the FAQ).
    await user.type(ask(), 'zzqqxx-first');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('reply 1');
    await user.type(ask(), 'zzqqxx-second');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('reply 2');

    // First turn: no prior context. Second turn: the full first exchange, in order.
    expect(seen[0]).toEqual([]);
    expect(seen[1]).toEqual([
      { role: 'user', text: 'zzqqxx-first' },
      { role: 'assistant', text: 'reply 1' },
    ]);
  });

  it('passes ALL tour ids (current page first, with page keys) and the page catalog to the runner', async () => {
    const user = userEvent.setup();
    const seen: Array<AssistantRunRequest['context']> = [];
    const runner: AssistantRunner = async ({ context }) => {
      seen.push(context);
      return { status: 'ok', text: 'ok' };
    };
    renderProvider({
      runner,
      aiEnabled: true,
      tours: {
        // Registry order deliberately puts another page's tour FIRST — the
        // current page's tour must still be listed first for the model.
        Outreach: [{ targetHelpId: 'outreach.drafts', title: 'Review drafts', body: 'Approve or revise.' }],
        Scout: [{ targetHelpId: 'scout.run', title: 'Run your first search', body: 'Click Run Scout.' }],
      },
      verifyChecks: [{ checkId: 'api-key', label: 'Configure API key' }],
    });

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'zzqqxx-give me a tour');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('ok');

    // All tours ride along (cross-page guidance: navigate first, then start_tour).
    expect(seen[0]?.tours).toEqual([
      { tourId: 'Scout', label: 'Run your first search', pageKey: 'Scout' },
      { tourId: 'Outreach', label: 'Review drafts', pageKey: 'Outreach' },
    ]);
    // The navigate tool's page-key catalog comes from the content registry.
    expect(seen[0]?.pages).toEqual([{ pageKey: 'Scout', label: 'Scout' }]);
    // The verify_step check-id catalog rides through from the host.
    expect(seen[0]?.checks).toEqual([{ checkId: 'api-key', label: 'Configure API key' }]);
  });

  describe('workspace-LLM fallback consent (busy answers)', () => {
    /** Runner scripted: busy-with-offer until allowFallback, then a real answer. */
    const consentRunner = (calls: Array<{ allowFallback?: boolean }>) => {
      const runner: AssistantRunner = async ({ allowFallback }) => {
        calls.push({ allowFallback });
        if (!allowFallback) return { status: 'busy', text: '', fallback: { label: 'anthropic · claude-test' } };
        return { status: 'ok', text: 'Answered by your model.' };
      };
      return runner;
    };

    it('offers consent on a busy answer, retries with allowFallback on accept, and shows the revoke strip', async () => {
      const calls: Array<{ allowFallback?: boolean }> = [];
      renderProvider({ runner: consentRunner(calls), aiEnabled: true });
      const ask = (question: string) => {
        fireEvent.change(screen.getByRole('textbox', { name: /ask the help assistant/i }), {
          target: { value: question },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      };

      fireEvent.click(screen.getByRole('button', { name: 'Help' }));
      ask('zzqqxx-help me');

      // Busy answer carries the consent offer; nothing was spent yet.
      const accept = await screen.findByRole('button', { name: /use my model \(anthropic · claude-test\)/i });
      expect(calls).toEqual([{ allowFallback: false }]);

      fireEvent.click(accept);

      // The retry ran with consent and REPLACED the busy placeholder.
      expect(await screen.findByText('Answered by your model.')).toBeInTheDocument();
      expect(calls).toEqual([{ allowFallback: false }, { allowFallback: true }]);
      expect(screen.queryByText(/busy right now/i)).not.toBeInTheDocument();

      // The revoke strip is now visible — the user can always switch back.
      expect(screen.getByText(/using your model \(anthropic · claude-test\)/i)).toBeInTheDocument();
      const stop = screen.getByRole('button', { name: /stop using my model/i });

      // Consent persists for the session: the next question auto-allows fallback.
      ask('zzqqxx-and next?');
      await waitFor(() => expect(calls).toHaveLength(3));
      expect(calls[2]).toEqual({ allowFallback: true });

      // Revoking flips later questions back to the free-only path.
      fireEvent.click(stop);
      expect(screen.queryByRole('button', { name: /stop using my model/i })).not.toBeInTheDocument();
      ask('zzqqxx-free again');
      await waitFor(() => expect(calls).toHaveLength(4));
      expect(calls[3]).toEqual({ allowFallback: false });
    });

    it('shows no consent offer when the busy answer carries no fallback', async () => {
      const user = userEvent.setup();
      const runner = createFakeAssistantRunner({ answer: '', status: 'busy' });
      renderProvider({ runner, aiEnabled: true });
      await user.click(screen.getByRole('button', { name: 'Help' }));
      await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'zzqqxx-anything');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      await screen.findByText(/busy right now/i);
      expect(screen.queryByRole('button', { name: /use my model/i })).not.toBeInTheDocument();
    });
  });

  it('restores the prior conversation from the history store on mount (reload resumes)', async () => {
    const user = userEvent.setup();
    const store = createMemoryHistoryStore();
    await store.appendMessage({ id: 'm1', role: 'user', text: 'earlier question' });
    await store.appendMessage({ id: 'm2', role: 'assistant', text: 'earlier answer' });

    renderProvider({ historyStore: store, runner: createFakeAssistantRunner({ answer: 'ok' }), aiEnabled: true });
    await user.click(screen.getByRole('button', { name: 'Help' }));

    // Both restored turns surface in the thread without the user asking anything.
    expect(await screen.findByText('earlier answer')).toBeInTheDocument();
    expect(screen.getByText('earlier question')).toBeInTheDocument();
  });
});

describe('browser language through HelpProvider', () => {
  it('sends the preferred browser language to the real chat entrypoint without a host locale prop', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['sv-SE', 'en-US']);
    const requests: AssistantRunRequest[] = [];
    const runner: AssistantRunner = async (request) => {
      requests.push(request);
      return { status: 'ok', text: 'Hej!' };
    };
    renderProvider({ runner, aiEnabled: true, historyStore: createMemoryHistoryStore() });
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.change(screen.getByRole('textbox', { name: /ask the help assistant/i }), {
      target: { value: 'Help me' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].context?.locale).toBe('sv-SE');
    vi.restoreAllMocks();
  });
});
