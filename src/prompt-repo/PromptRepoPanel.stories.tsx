import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import type { WorkspaceProjectController } from '../hooks/use-workspace-project';
import { PromptRepoPanel } from './PromptRepoPanel';
import { emptyProjectDefinitions } from './project-definitions';

const workspace: WorkspaceProjectController = {
  enabled: true,
  loading: false,
  pending: 0,
  busy: false,
  error: null,
  generation: 0,
  project: {
    ok: true,
    open: true,
    projectId: 'example',
    revision: 3,
    name: 'Writing toolkit',
    branch: 'main',
    remote: 'https://github.com/example/prompts',
    definitions: emptyProjectDefinitions('Writing toolkit'),
    documents: [
      { id: 'research', title: 'Research', path: 'prompts/research.md', text: 'Research the company.' },
      { id: 'outreach', title: 'Outreach', path: 'prompts/outreach.md', text: 'Write an introduction.' },
    ],
  },
  draft: fn(async () => undefined),
  flush: fn(async () => undefined),
  retry: fn(async () => undefined),
  keepSavedVersion: fn(async () => undefined),
  reopenOriginalProject: fn(async () => undefined),
  switchProject: fn(async () => undefined),
  save: fn(async () => undefined),
  restore: fn(async () => undefined),
  exportProject: fn(async () => ({
    format: 'prompt-studio-project-files@1' as const,
    name: 'Writing toolkit',
    files: [],
  })),
  publish: fn(async () => ({ url: 'https://github.com/example/prompts/pull/1' })),
  exportRecovery: () => ({ revision: 3, patches: [] }),
};
const meta = {
  decorators: [
    (Story) => (
      <div className="studio min-h-dvh bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
  title: 'Prompts/PromptStudio/Project',
  beforeEach: ({ globals }) => {
    localStorage.setItem('prompt-studio-theme', globals.theme === 'dark' ? 'dark' : 'light');
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/__studio/github/status'))
        return new Response(JSON.stringify({ ok: true, configured: true, connected: false }), {
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/__studio/prompt-repo/history?'))
        return Response.json({
          ok: true,
          versions: [{ commit: 'checkpoint12345', message: 'Clarify customer evidence' }],
        });
      if (url.endsWith('/__studio/prompt-repo/recent'))
        return new Response(JSON.stringify({ ok: true, projects: [] }), {
          headers: { 'content-type': 'application/json' },
        });
      return original(input, init);
    };
    return () => {
      globalThis.fetch = original;
    };
  },
  component: PromptRepoPanel,
  args: { workspace, onClose: fn() },
} satisfies Meta<typeof PromptRepoPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const OpenProject: Story = {};
export const Empty: Story = { args: { workspace: { ...workspace, project: null } } };
export const Saving: Story = { args: { workspace: { ...workspace, pending: 1, busy: true } } };
export const FailedSaveWithProject: Story = {
  args: {
    workspace: { ...workspace, error: 'Your changes could not be saved. Your edits are retained; retry saving.' },
  },
};
export const FailedOpen: Story = {
  args: {
    workspace: {
      ...workspace,
      project: null,
      error: 'Could not open this repository. Check the path or connect GitHub and retry.',
    },
  },
};

export const DiscardRecoveredEdits: Story = {
  args: FailedSaveWithProject.args,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Keep saved version' }));
  },
};

export const RecoveryFromPreviousSession: Story = {
  args: {
    workspace: {
      ...workspace,
      recoveryBackups: [
        {
          key: 'earlier-editor',
          recovery: {
            revision: 2,
            updatedAt: 1791216000000,
            patches: [{ documents: [{ path: 'prompts/research.md', text: 'Retained research edits' }] }],
          },
        },
      ],
      recoverBackup: fn(async () => undefined),
      removeRecoveryBackup: fn(async () => undefined),
    },
  },
};

export const RemoveRecoveryBackup: Story = {
  args: RecoveryFromPreviousSession.args,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Remove backup 1' }));
  },
};

export const Welcome: Story = {
  args: { presentation: 'welcome', workspace: { ...workspace, project: null } },
};
export const Versions: Story = { args: { section: 'versions' } };
export const Share: Story = { args: { section: 'share' } };
export const MobileWelcome: Story = {
  args: Welcome.args,
  parameters: { viewport: { defaultViewport: 'iphoneSE' } },
};

// Exercise the panel's own failure path while the open project remains visible.
export const FailedOpenWithProject: Story = {
  args: {
    workspace: {
      ...workspace,
      switchProject: async () => {
        throw new Error('Could not open that repository. Your current project is still open.');
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Repository URL or filesystem path'), '/missing/prompts');
    await userEvent.click(canvas.getByRole('button', { name: /^Open project$/ }));
  },
};

export const ImportPreview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const file = new File(
      [
        JSON.stringify({
          format: 'prompt-studio-project-files@1',
          name: 'Customer toolkit',
          files: [
            { path: 'prompts/brief.md', base64: 'YnJpZWY=' },
            { path: 'references/customer-notes.md', base64: 'bm90ZXM=' },
          ],
        }),
      ],
      'customer-toolkit.json',
      { type: 'application/json' },
    );
    await userEvent.upload(canvas.getByLabelText('Import project archive (JSON)'), file);
    await userEvent.click(await canvas.findByText('Included files'));
  },
};

export const RestorePromptFromCheckpoint: Story = {
  args: { section: 'versions' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Saved versions'));
    await userEvent.selectOptions(canvas.getByRole('combobox', { name: 'Prompt' }), 'prompts/research.md');
    await canvas.findByText('Clarify customer evidence (checkpo)');
  },
};
