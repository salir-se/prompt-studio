// @module-tag dom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FaqItem } from '../core/types';
import { HelpPanel } from './HelpPanel';

const FAQ: FaqItem[] = [
  { id: 'scout.what', question: 'How do I start a search?', answer: 'Click Run Scout.' },
  { id: 'scout.score', question: 'What is a signal score?', answer: 'A 0-100 readiness score.' },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof HelpPanel>> = {}) {
  const onClose = vi.fn();
  render(<HelpPanel pageKey="Scout" pageLabel="Scout" faq={FAQ} onClose={onClose} {...overrides} />);
  return { onClose };
}

describe('HelpPanel', () => {
  it('renders as a non-modal dialog labelled by the page and lists the FAQ', () => {
    renderPanel();
    const dialog = screen.getByRole('dialog', { name: /help — scout/i });
    expect(dialog).toHaveAttribute('aria-modal', 'false');
    expect(screen.getByRole('button', { name: 'How do I start a search?' })).toBeInTheDocument();
  });

  it('calls onClose when the close button is pressed', async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Close help' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('hides the chat composer when AI is disabled (FAQ still works)', () => {
    renderPanel({ aiEnabled: false });
    expect(screen.queryByRole('textbox', { name: /ask the help assistant/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What is a signal score?' })).toBeInTheDocument();
  });

  it('sends a trimmed chat message and clears the input when AI is enabled', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderPanel({ aiEnabled: true, onSend });
    const input = screen.getByRole('textbox', { name: /ask the help assistant/i });
    await user.type(input, '  how do I run scout?  ');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('how do I run scout?');
    expect(input).toHaveValue('');
  });

  it('does not send an empty message', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderPanel({ aiEnabled: true, onSend });
    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), '   ');
    // The Send button is disabled for whitespace-only input.
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('renders a tour launcher per tour id and starts the chosen tour', async () => {
    const user = userEvent.setup();
    const onStartTour = vi.fn();
    renderPanel({ tourIds: ['Scout'], onStartTour });
    await user.click(screen.getByRole('button', { name: 'Take a tour' }));
    expect(onStartTour).toHaveBeenCalledExactlyOnceWith('Scout');
  });

  it('renders the bottom-sheet layout when variant=bottom-sheet (mobile §G12)', () => {
    renderPanel({ variant: 'bottom-sheet' });
    expect(screen.getByRole('dialog', { name: /help — scout/i })).toHaveAttribute('data-help-variant', 'bottom-sheet');
  });

  it('renders the conversation when AI is enabled', () => {
    renderPanel({
      aiEnabled: true,
      messages: [
        { id: 'm1', role: 'user', text: 'How do I run Scout?' },
        { id: 'm2', role: 'assistant', text: 'Click the Run Scout button.' },
      ],
    });
    expect(screen.getByText('How do I run Scout?')).toBeInTheDocument();
    expect(screen.getByText('Click the Run Scout button.')).toBeInTheDocument();
  });

  it('renders an assistant answer as Markdown (bold + numbered list), not raw text', () => {
    renderPanel({
      aiEnabled: true,
      messages: [
        { id: 'u1', role: 'user', text: 'where do I edit drafts?' },
        { id: 'a1', role: 'assistant', text: 'Go to the **Outreach** tab:\n1. Open it\n2. Click Edit' },
      ],
    });
    // **Outreach** becomes a <strong>, not literal asterisks.
    expect(screen.getByText('Outreach').tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*Outreach\*\*/)).not.toBeInTheDocument();
    // The numbered list renders inside an ordered list, not as a literal "1." line.
    expect(screen.getByText('Open it').closest('ol')).not.toBeNull();
    expect(screen.getByText('Click Edit').closest('ol')).not.toBeNull();
  });

  it('shows a "Thinking…" indicator while a send is in flight (busy)', () => {
    renderPanel({
      aiEnabled: true,
      busy: true,
      messages: [{ id: 'u1', role: 'user', text: 'How do I run Scout?' }],
    });
    expect(screen.getByRole('listitem', { name: /assistant is thinking/i })).toBeInTheDocument();
    // The conversation log advertises its in-flight state to assistive tech.
    expect(screen.getByRole('log', { name: 'Conversation' })).toHaveAttribute('aria-busy', 'true');
  });

  it('hides the "Thinking…" indicator once a send completes', () => {
    renderPanel({
      aiEnabled: true,
      busy: false,
      messages: [
        { id: 'u1', role: 'user', text: 'How do I run Scout?' },
        { id: 'a1', role: 'assistant', text: 'Click Run Scout.' },
      ],
    });
    expect(screen.queryByRole('listitem', { name: /assistant is thinking/i })).not.toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Conversation' })).toHaveAttribute('aria-busy', 'false');
  });

  it('starts a new conversation from the header and clears the thread', async () => {
    const user = userEvent.setup();
    const onNewConversation = vi.fn();
    renderPanel({
      aiEnabled: true,
      onNewConversation,
      messages: [
        { id: 'u1', role: 'user', text: 'How do I run Scout?' },
        { id: 'a1', role: 'assistant', text: 'Click Run Scout.' },
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Start a new conversation' }));
    expect(onNewConversation).toHaveBeenCalledOnce();
  });

  it('hides the "New conversation" control until the thread has messages', () => {
    renderPanel({ aiEnabled: true, onNewConversation: vi.fn(), messages: [] });
    expect(screen.queryByRole('button', { name: 'Start a new conversation' })).not.toBeInTheDocument();
  });

  it('hides the "New conversation" control when no handler is wired', () => {
    renderPanel({
      aiEnabled: true,
      messages: [{ id: 'u1', role: 'user', text: 'Hi' }],
    });
    expect(screen.queryByRole('button', { name: 'Start a new conversation' })).not.toBeInTheDocument();
  });

  it('disables the "New conversation" control while a send is in flight', () => {
    renderPanel({
      aiEnabled: true,
      busy: true,
      onNewConversation: vi.fn(),
      messages: [{ id: 'u1', role: 'user', text: 'How do I run Scout?' }],
    });
    expect(screen.getByRole('button', { name: 'Start a new conversation' })).toBeDisabled();
  });

  it('toggles the past-conversations browser from the history clock and reopens an entry', async () => {
    const user = userEvent.setup();
    const onOpenConversation = vi.fn();
    renderPanel({
      aiEnabled: true,
      onOpenConversation,
      conversations: [{ id: 'c1', title: 'How do I run Scout?', archivedAt: Date.now(), messageCount: 2 }],
    });

    // Opening the browser swaps the body: the FAQ leaves the accessibility tree
    // (display:none), the list shows.
    await user.click(screen.getByRole('button', { name: 'Past conversations' }));
    const history = screen.getByRole('region', { name: 'Past conversations' });
    expect(within(history).getByText(/2 messages/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'How do I start a search?' })).not.toBeInTheDocument();

    // Clicking an entry reopens it and returns to the chat view.
    await user.click(within(history).getByRole('button', { name: /how do i run scout\?/i }));
    expect(onOpenConversation).toHaveBeenCalledExactlyOnceWith('c1');
    expect(screen.queryByRole('region', { name: 'Past conversations' })).not.toBeInTheDocument();
  });

  it('deletes an archived conversation via the × control', async () => {
    const user = userEvent.setup();
    const onDeleteConversation = vi.fn();
    renderPanel({
      aiEnabled: true,
      onOpenConversation: vi.fn(),
      onDeleteConversation,
      conversations: [{ id: 'c1', title: 'Old chat', archivedAt: Date.now(), messageCount: 1 }],
    });
    await user.click(screen.getByRole('button', { name: 'Past conversations' }));
    await user.click(screen.getByRole('button', { name: 'Delete conversation: Old chat' }));
    expect(onDeleteConversation).toHaveBeenCalledExactlyOnceWith('c1');
  });

  it('hides the history clock when nothing is archived or no handler is wired', () => {
    renderPanel({ aiEnabled: true, onOpenConversation: vi.fn(), conversations: [] });
    expect(screen.queryByRole('button', { name: 'Past conversations' })).not.toBeInTheDocument();
    renderPanel({
      aiEnabled: true,
      conversations: [{ id: 'c1', title: 'x', archivedAt: Date.now(), messageCount: 1 }],
    });
    expect(screen.queryByRole('button', { name: 'Past conversations' })).not.toBeInTheDocument();
  });

  it('rates an assistant answer 👍/👎 and reports it (§G3)', async () => {
    const user = userEvent.setup();
    const onFeedback = vi.fn();
    renderPanel({
      aiEnabled: true,
      onFeedback,
      messages: [
        { id: 'u1', role: 'user', text: 'How do I run Scout?' },
        { id: 'a1', role: 'assistant', text: 'Click the Run Scout button.' },
      ],
    });
    // Only the assistant answer carries feedback controls (not the user message).
    expect(screen.getAllByRole('button', { name: 'Helpful' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Not helpful' }));
    expect(onFeedback).toHaveBeenCalledExactlyOnceWith({ messageId: 'a1', rating: 'down' });
    expect(screen.getByRole('button', { name: 'Not helpful' })).toHaveAttribute('aria-pressed', 'true');
  });

  // --- Feature 1: local search before AI (§G2) ------------------------------
  describe('local search before AI (§G2)', () => {
    it('surfaces matching FAQ as suggestions and does NOT call onSend yet', async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      renderPanel({ aiEnabled: true, onSend });
      await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'how do I start a search');
      await user.click(screen.getByRole('button', { name: 'Send' }));

      // The local matches show in a labelled region; the AI was not called.
      const region = screen.getByRole('region', { name: /found in help/i });
      expect(within(region).getByText('How do I start a search?')).toBeInTheDocument();
      expect(onSend).not.toHaveBeenCalled();
    });

    it('expands a suggestion to reveal its answer', async () => {
      const user = userEvent.setup();
      renderPanel({ aiEnabled: true, onSend: vi.fn() });
      await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'signal score');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      // Scope to the "Found in help" region — the same question also exists in the
      // always-visible FAQ accordion above, so query within the suggestions.
      const region = screen.getByRole('region', { name: /found in help/i });
      await user.click(within(region).getByRole('button', { name: 'What is a signal score?' }));
      expect(within(region).getByText('A 0-100 readiness score.')).toBeInTheDocument();
    });

    it('escalates to the assistant when "Ask the assistant anyway" is clicked', async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      renderPanel({ aiEnabled: true, onSend });
      await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'how do I start a search');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      await user.click(screen.getByRole('button', { name: /ask the assistant anyway/i }));
      expect(onSend).toHaveBeenCalledExactlyOnceWith('how do I start a search');
    });

    it('sends straight to the assistant when there is no local match', async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      renderPanel({ aiEnabled: true, onSend });
      await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'zzqqxx-nomatch');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      expect(onSend).toHaveBeenCalledExactlyOnceWith('zzqqxx-nomatch');
      expect(screen.queryByRole('region', { name: /found in help/i })).not.toBeInTheDocument();
    });

    it('fires onSearch with the result count (match and no-match)', async () => {
      const user = userEvent.setup();
      const onSearch = vi.fn();
      renderPanel({ aiEnabled: true, onSend: vi.fn(), onSearch });
      const input = screen.getByRole('textbox', { name: /ask the help assistant/i });
      await user.type(input, 'how do I start a search');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      expect(onSearch).toHaveBeenLastCalledWith('how do I start a search', expect.any(Number));
      expect(onSearch.mock.calls.at(-1)?.[1]).toBeGreaterThan(0);

      await user.clear(input);
      await user.type(input, 'zzqqxx-nomatch');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      expect(onSearch).toHaveBeenLastCalledWith('zzqqxx-nomatch', 0);
    });

    it('resubmitting the same query (send again) escalates to the assistant', async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      renderPanel({ aiEnabled: true, onSend });
      const input = screen.getByRole('textbox', { name: /ask the help assistant/i });
      await user.type(input, 'how do I start a search');
      await user.click(screen.getByRole('button', { name: 'Send' })); // first submit → suggestions
      expect(onSend).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Send' })); // send again → AI
      expect(onSend).toHaveBeenCalledExactlyOnceWith('how do I start a search');
    });
  });

  // --- Feature 2: support escalation (§G4) ----------------------------------
  describe('support escalation (§G4)', () => {
    const assistantStatus = (status: 'quota' | 'error' | 'busy') => ({
      aiEnabled: true,
      messages: [
        { id: 'u1', role: 'user' as const, text: 'A question' },
        { id: 'a1', role: 'assistant' as const, text: '', status },
      ],
    });

    it('surfaces the contact-support button after a quota answer', () => {
      const onEscalateSupport = vi.fn();
      renderPanel({ ...assistantStatus('quota'), onEscalateSupport });
      expect(screen.getByRole('button', { name: /contact support/i })).toBeInTheDocument();
    });

    it('labels a busy answer as transient (try again) — never as the daily limit', () => {
      renderPanel(assistantStatus('busy'));
      expect(screen.getByText(/busy right now — try again/i)).toBeInTheDocument();
      expect(screen.queryByText(/daily help limit/i)).not.toBeInTheDocument();
    });

    it('surfaces the contact-support button after a busy answer', () => {
      const onEscalateSupport = vi.fn();
      renderPanel({ ...assistantStatus('busy'), onEscalateSupport });
      expect(screen.getByRole('button', { name: /contact support/i })).toBeInTheDocument();
    });

    it('surfaces the contact-support button after an error answer', () => {
      const onEscalateSupport = vi.fn();
      renderPanel({ ...assistantStatus('error'), onEscalateSupport });
      expect(screen.getByRole('button', { name: /contact support/i })).toBeInTheDocument();
    });

    it('calls onEscalateSupport when the button is clicked', async () => {
      const user = userEvent.setup();
      const onEscalateSupport = vi.fn();
      renderPanel({ ...assistantStatus('quota'), onEscalateSupport });
      await user.click(screen.getByRole('button', { name: /contact support/i }));
      expect(onEscalateSupport).toHaveBeenCalledOnce();
    });

    it('does not render the button when onEscalateSupport is absent', () => {
      renderPanel(assistantStatus('quota'));
      expect(screen.queryByRole('button', { name: /contact support/i })).not.toBeInTheDocument();
    });

    it('auto-surfaces the button when local search returns no results', async () => {
      const user = userEvent.setup();
      const onEscalateSupport = vi.fn();
      renderPanel({ aiEnabled: true, onSend: vi.fn(), onEscalateSupport });
      // A healthy ok answer alone does not surface support…
      expect(screen.queryByRole('button', { name: /contact support/i })).not.toBeInTheDocument();
      await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'zzqqxx-nomatch');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      // …but a fruitless local search does.
      expect(screen.getByRole('button', { name: /contact support/i })).toBeInTheDocument();
    });
  });

  // --- Feature 3: answer sources + confidence chips (§G5) -------------------
  describe('answer sources + confidence (§G5)', () => {
    it('renders source chips with their titles when sources are present', () => {
      renderPanel({
        aiEnabled: true,
        messages: [
          { id: 'u1', role: 'user', text: 'How do I run Scout?' },
          {
            id: 'a1',
            role: 'assistant',
            text: 'Click Run Scout.',
            confidence: 'high',
            sources: [
              { type: 'faq', id: 'scout.what', title: 'Starting a search' },
              { type: 'material', id: 'guide', title: 'Scout guide' },
            ],
          },
        ],
      });
      const chips = screen.getByRole('list', { name: /answer sources/i });
      expect(within(chips).getByText(/starting a search/i)).toBeInTheDocument();
      expect(within(chips).getByText(/scout guide/i)).toBeInTheDocument();
    });

    it('renders a low-confidence caveat and the support affordance', () => {
      const onEscalateSupport = vi.fn();
      renderPanel({
        aiEnabled: true,
        onEscalateSupport,
        messages: [
          { id: 'u1', role: 'user', text: 'How do I run Scout?' },
          { id: 'a1', role: 'assistant', text: 'Maybe click Run Scout.', confidence: 'low' },
        ],
      });
      // The answer text is still shown; the caveat is additive (not a replacement).
      expect(screen.getByText('Maybe click Run Scout.')).toBeInTheDocument();
      expect(screen.getByText(/double-check/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /contact support/i })).toBeInTheDocument();
    });

    it('renders neither chips nor caveat for a plain answer', () => {
      renderPanel({
        aiEnabled: true,
        messages: [
          { id: 'u1', role: 'user', text: 'How do I run Scout?' },
          { id: 'a1', role: 'assistant', text: 'Click Run Scout.' },
        ],
      });
      expect(screen.queryByRole('list', { name: /answer sources/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/low confidence|double-check/i)).not.toBeInTheDocument();
    });
  });
});
