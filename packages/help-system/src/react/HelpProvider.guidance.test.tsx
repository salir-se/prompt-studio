// @module-tag dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AssistantRunner } from '../core/adapters';
import type { HelpContent } from '../core/types';
import { createFakeAssistantRunner } from '../testing/fake-runner';
import { HelpProvider, type HelpProviderProps } from './HelpProvider';
import { useHelp } from './useHelp';

const content: HelpContent = { pages: { Scout: { pageLabel: 'Scout', faq: [] } } };
function renderProvider(overrides: Partial<HelpProviderProps>) {
  return render(<HelpProvider content={content} pageKey="Scout" {...overrides} />);
}

describe('#2713 Help guidance', () => {
  it('#2713: grounds conceptual questions in other allowed pages without navigating or copying every FAQ', async () => {
    const user = userEvent.setup({ delay: null });
    const navigate = vi.fn();
    let supplied: unknown;
    const runner: AssistantRunner = async ({ context }) => {
      supplied = context;
      return { status: 'ok', text: 'Shared Scheduler runs in the cloud when configured.' };
    };
    renderProvider({
      runner,
      aiEnabled: true,
      navigate,
      content: {
        pages: {
          Scout: content.pages.Scout!,
          Scheduler: {
            pageLabel: 'Scheduler',
            faq: [{ id: 'detail', question: 'Detailed setup', answer: 'Do not copy every remote FAQ.' }],
            aiContext: { systemPromptAppendix: 'Shared Scheduler supports cloud execution when configured.' },
          },
        },
      },
    });
    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'zzqqxx-unattended');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Shared Scheduler runs in the cloud when configured.');
    expect(supplied).toMatchObject({
      pageLabel: 'Scout',
      pages: [
        { pageKey: 'Scout', label: 'Scout' },
        {
          pageKey: 'Scheduler',
          label: 'Scheduler',
          summary: 'Shared Scheduler supports cloud execution when configured.',
        },
      ],
      faqDigest: [],
    });
    expect(JSON.stringify(supplied)).not.toContain('Do not copy every remote FAQ.');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('#2713: clears the Help panel from the tour target and restores the conversation afterward', async () => {
    const user = userEvent.setup({ delay: null });
    function EndTour() {
      const help = useHelp();
      return (
        <>
          <button onClick={help.endTour}>End test tour</button>
          <button onClick={() => help.startTour('Scout')}>Start test tour</button>
        </>
      );
    }
    const runner = createFakeAssistantRunner({
      toolCalls: [{ name: 'start_tour', input: { tour_id: 'Scout' } }],
      answer: 'Follow the tour, then add your key.',
    });
    renderProvider({
      runner,
      aiEnabled: true,
      tours: {
        Scout: [{ targetHelpId: 'scout.run', title: 'Run your first search', body: 'Run Scout.' }],
      },
      children: <EndTour />,
    });
    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'zzqqxx-tour');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.queryByRole('dialog', { name: /help — scout/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'End test tour' }));
    expect(screen.getByRole('dialog', { name: /help — scout/i })).toBeInTheDocument();
    expect(screen.getByText('Follow the tour, then add your key.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'Keep this draft');
    // A missing target leaves no tooltip: both public escape hatches still recover chat.
    await user.click(screen.getByRole('button', { name: 'Start test tour' }));
    await user.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('dialog', { name: /help — scout/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /ask the help assistant/i })).toHaveValue('Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Start test tour' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: /help — scout/i })).toBeInTheDocument();
  });

  it('#2713: returns destination controls and materials after navigation without another credential request', async () => {
    const user = userEvent.setup({ delay: null });
    let result: unknown;
    const runner: AssistantRunner = async ({ dispatchTool }) => {
      result = await dispatchTool('navigate', { page_key: 'Settings' });
      return { status: 'ok', text: 'Settings guidance ready.' };
    };
    renderProvider({
      runner,
      aiEnabled: true,
      navigate: vi.fn(),
      content: {
        ...content,
        pages: {
          ...content.pages,
          Settings: {
            pageLabel: 'Settings',
            faq: [],
            highlightables: [{ helpId: 'settings.provider', label: 'AI provider', description: 'Connect your key.' }],
            aiContext: { materials: [{ title: 'Connect AI', body: 'Open your provider card.' }] },
          },
        },
      },
    });
    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'zzqqxx-settings');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Settings guidance ready.');
    expect(result).toMatchObject({
      ok: true,
      page_key: 'Settings',
      context: {
        pageLabel: 'Settings',
        highlightables: [{ helpId: 'settings.provider', label: 'AI provider', description: 'Connect your key.' }],
        materials: [{ title: 'Connect AI', body: 'Open your provider card.' }],
      },
    });
  });

  it('#2713: waits for host navigation before acknowledging it to the runner', async () => {
    const user = userEvent.setup({ delay: null });
    let finishNavigation!: () => void;
    const navigation = new Promise<void>((resolve) => {
      finishNavigation = resolve;
    });
    const navigated = vi.fn();
    const runner: AssistantRunner = async ({ dispatchTool }) => {
      await dispatchTool('navigate', { page_key: 'Scout' });
      navigated();
      return { status: 'ok', text: 'Navigation complete.' };
    };
    const navigate = vi.fn(() => navigation);
    renderProvider({ runner, aiEnabled: true, navigate });
    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'zzqqxx-wait');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(navigate).toHaveBeenCalledWith('Scout');
    expect(navigated).not.toHaveBeenCalled();
    finishNavigation();
    await screen.findByText('Navigation complete.');
    expect(navigated).toHaveBeenCalledOnce();
  });

  it('#2713: rejects invented tour titles and page keys with the valid catalog', async () => {
    const user = userEvent.setup({ delay: null });
    const navigate = vi.fn();
    const results: unknown[] = [];
    const runner: AssistantRunner = async ({ dispatchTool }) => {
      results.push(await dispatchTool('start_tour', { tour_id: 'Run your first search' }));
      results.push(await dispatchTool('navigate', { page_key: 'scout' }));
      return { status: 'ok', text: 'Recovered guidance.' };
    };
    renderProvider({
      runner,
      aiEnabled: true,
      navigate,
      tours: {
        Scout: [{ targetHelpId: 'scout.run', title: 'Run your first search', body: 'Run Scout.' }],
      },
    });
    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.type(screen.getByRole('textbox', { name: /ask the help assistant/i }), 'zzqqxx-tour');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Recovered guidance.');
    expect(results).toEqual([
      { ok: false, tour_id: 'Run your first search' },
      { ok: false, page_key: 'scout' },
    ]);
    expect(navigate).not.toHaveBeenCalled();
  });
});
