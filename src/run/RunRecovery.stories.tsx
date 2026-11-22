import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { RunWorkspace } from './RunWorkspace';
import { CAPTURED_EVALUATION, RUN_SETTINGS, RUN_SETUP, RUN_SOURCE, TAG_CANDIDATE, TEST_SUITE } from './run-fixtures';

const meta = {
  title: 'Prompts/PromptStudio/RunRecovery',
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="studio h-dvh bg-background text-foreground">
      <RunWorkspace
        project={{ projectId: 'recovery-story', revision: 3 }}
        promptPath="prompts/research.md"
        source={RUN_SOURCE}
        draft={false}
        onClose={() => {}}
      />
    </div>
  ),
  beforeEach: () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const path = String(input);
      if (!path.includes('/__studio/')) return original(input, init);
      if (init?.method === 'POST')
        return Response.json({ error: 'Git tag already exists. Choose another name.' }, { status: 409 });
      if (path.endsWith('/settings')) return Response.json(RUN_SETTINGS);
      if (path.includes('/profile?')) return Response.json({ profile: RUN_SETUP });
      if (path.includes('/suites?')) return Response.json({ suites: [TEST_SUITE] });
      if (path.includes('/versions?')) return Response.json({ versions: [TAG_CANDIDATE] });
      if (path.includes('/evaluations?')) return Response.json({ evaluations: [CAPTURED_EVALUATION] });
      return Response.json({ runs: [] });
    };
    return () => {
      globalThis.fetch = original;
    };
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

async function failTag(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('tab', { name: 'Compare' }));
  const compare = within(await canvas.findByRole('tabpanel', { name: 'Compare' }));
  await userEvent.clear(compare.getByRole('textbox', { name: 'Judging rubric' }));
  await userEvent.type(compare.getByRole('textbox', { name: 'Judging rubric' }), 'Preserve this unfinished rubric.');
  await userEvent.click(compare.getByText('Save a Git version tag'));
  await userEvent.type(compare.getByRole('textbox', { name: 'New Git tag' }), 'existing-tag');
  await userEvent.click(compare.getByRole('button', { name: 'Create Git tag' }));
  await expect(await canvas.findByRole('alert')).toHaveFocus();
  return { canvas, compare };
}
export const FailedAction: Story = {
  play: async ({ canvasElement }) => {
    await failTag(canvasElement);
  },
};
export const RefreshedWithDrafts: Story = {
  play: async ({ canvasElement }) => {
    const { canvas, compare } = await failTag(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Reload saved evaluations' }));
    await expect(compare.getByRole('textbox', { name: 'Judging rubric' })).toHaveValue(
      'Preserve this unfinished rubric.',
    );
    await expect(compare.getByRole('textbox', { name: 'New Git tag' })).toHaveValue('existing-tag');
    await userEvent.click(compare.getByRole('textbox', { name: 'New Git tag' }));
  },
};
