import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { useWorkspaceProject } from '../hooks/use-workspace-project';
import { emptyProjectDefinitions } from '../prompt-repo/project-definitions';
import { ProjectSaveStatus } from './ProjectSaveStatus';

const instructions = '# Task\nKeep my unsaved instructions after a local server restart.';
const project = {
  ok: true,
  open: true,
  projectId: 'session-story',
  revision: 7,
  name: 'Restart recovery',
  branch: 'main',
  documents: [],
  definitions: emptyProjectDefinitions('Restart recovery'),
};

function SessionStory() {
  const workspace = useWorkspaceProject();
  return (
    <div className="studio min-h-dvh bg-background text-foreground">
      <ProjectSaveStatus
        project={workspace.project}
        pending={workspace.pending}
        error={workspace.error}
        requiredTools={[]}
        onRetry={() => void workspace.retry().catch(() => {})}
        onOpenTools={() => {}}
      />
      <div className="grid gap-3 p-4">
        <label htmlFor="retained-instructions">Prompt instructions</label>
        <textarea
          id="retained-instructions"
          className="min-h-40 w-full rounded border bg-background p-3"
          readOnly
          value={instructions}
        />
        <button
          type="button"
          disabled={workspace.loading}
          className="justify-self-start rounded border px-3 py-2"
          onClick={() =>
            void workspace.draft({ documents: [{ path: 'prompts/task.md', text: instructions }] }).catch(() => {})
          }
        >
          Save draft
        </button>
      </div>
    </div>
  );
}
const meta = {
  title: 'Prompts/PromptStudio/SessionRecovery',
  parameters: { layout: 'fullscreen' },
  render: () => <SessionStory />,
  beforeEach: () => {
    const original = globalThis.fetch;
    const tags = ['studio-token', 'studio-workspace'].map((name) => {
      const tag = document.createElement('meta');
      tag.name = name;
      tag.content = 'old-token';
      document.head.append(tag);
      return tag;
    });
    globalThis.fetch = async (input, init) => {
      const pathname = String(input);
      if (pathname === '/__studio/session') return Response.json({ error: 'Forbidden.' }, { status: 403 });
      if (pathname === '/__studio/prompt-repo/draft') return Response.json({ error: 'Unauthorized.' }, { status: 401 });
      if (pathname === '/__studio/prompt-repo') return Response.json(project);
      return original(input, init);
    };
    return () => {
      globalThis.fetch = original;
      for (const tag of tags) tag.remove();
      for (const key of Object.keys(localStorage))
        if (key.startsWith('prompt-studio-unsaved:session-story:')) localStorage.removeItem(key);
    };
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Saved: Story = {};
export const RefreshFailedWithDraft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const save = await canvas.findByRole('button', { name: 'Save draft' });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await expect(await canvas.findByRole('button', { name: 'Retry saving' })).toBeVisible();
    await expect(canvas.getByRole('status')).toHaveTextContent('export recovered changes before reopening Studio');
    await expect(canvas.getByRole('textbox', { name: 'Prompt instructions' })).toHaveValue(instructions);
  },
};
