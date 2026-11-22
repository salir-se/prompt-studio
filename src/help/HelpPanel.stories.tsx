import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { HelpPanel, saveHelpApiKey } from './HelpPanel';

const meta = {
  decorators: [
    (Story) => (
      <div className="studio min-h-dvh bg-background text-foreground">
        <div data-studio-panels>
          <Story />
        </div>
      </div>
    ),
  ],
  title: 'Prompts/PromptStudio/HelpAssistant',
  component: HelpPanel,
  beforeEach: ({ parameters }) => {
    saveHelpApiKey('');
    if (parameters.helpState === 'legacy') return;
    const tag = document.createElement('meta');
    tag.name = 'studio-workspace';
    tag.content = 'true';
    document.head.append(tag);
    const original = globalThis.fetch;
    let config = {
      provider: 'openai',
      model: parameters.helpState === 'long' ? 'a_very_long_model_identifier_'.repeat(7) : 'prompt-model',
      baseUrl: '',
      skillsFolder: '',
      skills: [],
      connected: parameters.helpState !== 'disconnected',
      connectedProviders: parameters.helpState === 'disconnected' ? [] : ['openai', 'anthropic'],
      helpModel: parameters.helpState === 'separate' ? { provider: 'anthropic', model: 'help-model' } : null,
    };
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith('/__studio/run/')) return original(input, init);
      if (url.endsWith('/settings')) {
        if (parameters.helpState === 'loading') return new Promise<Response>(() => {});
        if (parameters.helpState === 'settings-error')
          return Response.json({ error: 'Model settings could not be loaded. Retry to reconnect.' }, { status: 503 });
        if (init?.method === 'POST') config = { ...config, ...JSON.parse(String(init.body)) };
        return Response.json(config);
      }
      if (parameters.helpState === 'answer-error')
        return Response.json(
          { error: 'Help could not get a reply. Check the model connection in App settings and retry.' },
          { status: 503 },
        );
      const selected = config.helpModel ?? config;
      return Response.json({
        provider: selected.provider,
        model: selected.model,
        text: 'Open Your prompts → Versions, enter a version message and choose Save version. Prompt runs keep their own model.',
      });
    };
    return () => {
      tag.remove();
      globalThis.fetch = original;
    };
  },
  args: {
    context: { manifestName: 'Writing toolkit', rootCount: 2, selectedRootTitle: 'Customer Brief' },
    onClose: fn(),
    send: fn(async () => ({ text: 'Open Your prompts → Versions.' })),
  },
} satisfies Meta<typeof HelpPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Disconnected: Story = { parameters: { helpState: 'disconnected' } };
export const SharedModel: Story = {};
export const SeparateModel: Story = { parameters: { helpState: 'separate' } };
export const LoadingSettings: Story = { parameters: { helpState: 'loading' } };
export const SettingsError: Story = { parameters: { helpState: 'settings-error' } };
export const LongModel: Story = { parameters: { helpState: 'long' } };
const ask: NonNullable<Story['play']> = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const input = await canvas.findByRole('textbox', { name: 'Ask the help assistant' });
  await waitFor(() => expect(input).toBeEnabled());
  await userEvent.type(input, 'How do I save a version?');
  await userEvent.click(canvas.getByRole('button', { name: /^Ask$/ }));
};
export const Answered: Story = {
  play: async (context) => {
    await ask(context);
    await expect(await within(context.canvasElement).findByText(/Prompt runs keep their own model/)).toBeVisible();
  },
};
export const AnswerFailure: Story = {
  parameters: { helpState: 'answer-error' },
  play: async (context) => {
    await ask(context);
    await expect(await within(context.canvasElement).findByRole('alert')).toHaveTextContent('could not get a reply');
  },
};
export const UnsavedOverride: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('checkbox', { name: 'Use model from App settings' }));
    await userEvent.clear(canvas.getByRole('textbox', { name: /^Model$/ }));
    await userEvent.type(canvas.getByRole('textbox', { name: /^Model$/ }), 'compare-help-model');
  },
};
export const DeveloperConnection: Story = { parameters: { helpState: 'legacy' } };
