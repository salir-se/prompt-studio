import '../index.css';
import { Button } from '@prompt-studio/ui/button';
import { Input } from '@prompt-studio/ui/input';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { AdoptPromptDialog } from '../adoption/AdoptPromptDialog';
import { PromptWriter } from '../components/PromptWriter';
import { emptyProjectDefinitions } from '../prompt-repo/project-definitions';
import { ShortcutControl } from './ShortcutControl';
import { ShortcutEducation, ShortcutHelpMenu } from './ShortcutEducation';
import { useShortcutEducation } from './shortcut-context';

function LearningWorkspace() {
  const [text, setText] = useState(
    '<mission>\nSummarize the supplied document.\n</mission>\n\n<output>\nReturn the evidence.\n</output>',
  );
  const [saved, setSaved] = useState('');
  return (
    <ShortcutEducation>
      <div className="studio flex h-dvh flex-col bg-background text-foreground">
        <header className="flex items-center justify-between border-b p-3">
          <strong>Prompt Studio</strong>
          <ShortcutHelpMenu onAssistant={() => {}} />
        </header>
        <PromptWriter
          text={text}
          dirty={text !== saved}
          variables={['document']}
          tools={[]}
          onChange={setText}
          onApply={() => setSaved(text)}
          onDiscard={() => setText(saved)}
        />
      </div>
    </ShortcutEducation>
  );
}

const meta = {
  title: 'Prompts/PromptStudio/Shortcut learning',
  component: LearningWorkspace,
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    localStorage.removeItem('prompt-studio:shortcut-tips:v1');
    localStorage.removeItem('prompt-studio:compact-toolbars:v1');
    localStorage.removeItem('prompt-studio:line-numbers:v1');
  },
} satisfies Meta<typeof LearningWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;

async function openGuide(canvasElement: HTMLElement, name = 'Keyboard shortcuts') {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Help' }));
  await userEvent.click(within(document.body).getByRole('menuitem', { name }));
  const dialog = await within(document.body).findByRole('dialog', { name });
  await waitFor(() => expect(dialog).toBeVisible());
}

export const Guide: Story = {
  play: async ({ canvasElement }) => {
    await openGuide(canvasElement);
    await expect(within(document.body).getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    const toggle = within(document.body).getByRole('switch', { name: 'Show shortcut tips' });
    const track = toggle.querySelector('[data-slot="switch-track"]')!.getBoundingClientRect();
    await waitFor(() => {
      const target = toggle.getBoundingClientRect();
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
    });
    await expect(track.width / track.height).toBeGreaterThan(1.5);
  },
};
export const FilteredGuide: Story = {
  play: async ({ canvasElement }) => {
    await openGuide(canvasElement);
    await userEvent.type(within(document.body).getByRole('textbox', { name: 'Find a shortcut' }), 'section');
    await expect(within(document.body).getByText('Add subsection')).toBeVisible();
  },
};
export const EmptySearch: Story = {
  play: async ({ canvasElement }) => {
    await openGuide(canvasElement);
    await userEvent.type(within(document.body).getByRole('textbox', { name: 'Find a shortcut' }), 'nothing-matches');
    await expect(within(document.body).getByText(/No matching shortcuts/)).toBeVisible();
  },
};
export const SettingsOff: Story = {
  play: async ({ canvasElement }) => {
    await openGuide(canvasElement, 'App settings');
    const toggle = within(document.body).getByRole('switch', { name: 'Show shortcut tips' });
    await userEvent.click(toggle);
    await expect(toggle).not.toBeChecked();
    await expect(localStorage.getItem('prompt-studio:shortcut-tips:v1')).toBe('false');
  },
};
export const PointerTip: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(within(document.body).getByRole('status', { name: 'Shortcut tip' })).toBeVisible());
    await waitFor(() => {
      const target = within(document.body)
        .getByRole('button', { name: 'Dismiss notification' })
        .getBoundingClientRect();
      expect(target.width).toBeGreaterThanOrEqual(24);
      expect(target.height).toBeGreaterThanOrEqual(24);
    });
  },
};
export const TipWithDialog: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Sections/ }));
    await waitFor(() => expect(within(document.body).getByRole('dialog', { name: 'Jump to section' })).toBeVisible());
    await waitFor(() => expect(within(document.body).getByRole('button', { name: 'Turn off tips' })).toBeVisible());
    await waitFor(() => {
      const tip = within(document.body)
        .getByRole('status', { name: 'Shortcut tip' })
        .closest('[data-sonner-toast]')!
        .getBoundingClientRect();
      const dialog = within(document.body).getByRole('dialog', { name: 'Jump to section' }).getBoundingClientRect();
      expect(
        tip.left < dialog.right && tip.right > dialog.left && tip.top < dialog.bottom && tip.bottom > dialog.top,
      ).toBe(false);
    });
  },
};
export const FocusTooltipWithTipsOff: Story = {
  beforeEach: () => {
    localStorage.setItem('prompt-studio:shortcut-tips:v1', 'false');
  },
  play: async ({ canvasElement }) => {
    within(canvasElement)
      .getByRole('button', { name: /Sections/ })
      .focus();
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent('Jump to section');
  },
};
export const StorageUnavailable: Story = {
  play: async ({ canvasElement }) => {
    await openGuide(canvasElement, 'App settings');
    const original = Storage.prototype.setItem;
    try {
      Storage.prototype.setItem = () => {
        throw new Error('Storage unavailable');
      };
      await userEvent.click(within(document.body).getByRole('switch', { name: 'Show shortcut tips' }));
    } finally {
      Storage.prototype.setItem = original;
    }
    await expect(within(document.body).getByText(/Changed for this session/)).toBeVisible();
  },
};

export const LabelledToolbars: Story = {
  play: async ({ canvasElement }) => {
    const before = within(canvasElement)
      .getByRole('button', { name: /Sections/ })
      .getBoundingClientRect().width;
    await openGuide(canvasElement, 'App settings');
    await userEvent.click(within(document.body).getByRole('switch', { name: 'Compact toolbars' }));
    await userEvent.keyboard('{Escape}');
    const sections = await within(canvasElement).findByRole('button', { name: /Sections/ });
    await expect(sections.getBoundingClientRect().width).toBeGreaterThan(before);
    await expect(localStorage.getItem('prompt-studio:compact-toolbars:v1')).toBe('false');
  },
};

export const IconSectionPopover: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '+ Section' }));
    await expect(await within(document.body).findByRole('textbox', { name: 'Section name' })).toBeVisible();
    await userEvent.type(within(document.body).getByRole('textbox', { name: 'Section name' }), 'constraints');
  },
};

function CoveringAdoption() {
  const [open, setOpen] = useState(false);
  return (
    <ShortcutEducation>
      <div className="studio min-h-dvh bg-background p-4 text-foreground">
        <ShortcutControl id="addExisting">
          <Button onClick={() => setOpen(true)}>Add existing</Button>
        </ShortcutControl>
        {open && (
          <AdoptPromptDialog
            definitions={emptyProjectDefinitions('Test')}
            existingIds={[]}
            onAdopt={async () => {}}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </ShortcutEducation>
  );
}

export const CoveringDialogKeepsInputsClear: Story = {
  render: () => <CoveringAdoption />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Add existing' }));
    const dialog = await within(document.body).findByRole('dialog');
    await waitFor(() => expect(dialog).toBeVisible());
    await waitFor(() =>
      expect(within(document.body).queryByRole('status', { name: 'Shortcut tip' })).not.toBeInTheDocument(),
    );
    await expect(within(dialog).getByRole('textbox', { name: 'Existing prompt' })).toBeVisible();
  },
};

function NumberedWriter() {
  const [text, setText] = useState(
    [
      '<mission>',
      'Explain the supplied document using only its evidence. '.repeat(16),
      '',
      'Use {{document}} as the source.',
      '</mission>',
      ...Array.from({ length: 32 }, (_, index) => `Instruction ${index + 1}: keep source and answer aligned.`),
      '',
    ].join('\n'),
  );
  return (
    <ShortcutEducation>
      <div className="studio flex h-dvh flex-col bg-background text-foreground">
        <PromptWriter
          text={text}
          dirty
          variables={['document']}
          tools={[]}
          onChange={setText}
          onApply={() => {}}
          onDiscard={() => {}}
        />
      </div>
    </ShortcutEducation>
  );
}

export const WrappedLineNumbers: Story = {
  render: () => <NumberedWriter />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Prompt markdown' }) as HTMLTextAreaElement;
    const source = input.value;
    await userEvent.click(canvas.getByRole('button', { name: 'Line numbers' }));
    await expect(canvas.getByRole('button', { name: 'Line numbers' })).toHaveAttribute('aria-pressed', 'true');
    await expect(input).toHaveValue(source);
    const backdrop = canvas.getByTestId('highlighted-prompt-text-backdrop');
    const numbers = canvas.getAllByTestId('prompt-line-number');
    await expect(numbers).toHaveLength(source.split('\n').length);
    const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight);
    // A wrapped source line consumes several visual lines but receives one source number.
    await expect(numbers[2].getBoundingClientRect().top - numbers[1].getBoundingClientRect().top).toBeGreaterThan(
      lineHeight * 2,
    );
    await expect(Math.abs(backdrop.scrollHeight - input.scrollHeight)).toBeLessThanOrEqual(2);
    const firstTop = numbers[0].getBoundingClientRect().top;
    input.scrollTop = Math.min(160, input.scrollHeight - input.clientHeight);
    input.dispatchEvent(new Event('scroll', { bubbles: true }));
    await waitFor(() => expect(backdrop.scrollTop).toBe(input.scrollTop));
    await expect(Math.abs(numbers[0].getBoundingClientRect().top - firstTop + input.scrollTop)).toBeLessThanOrEqual(1);
    input.scrollTop = 0;
    input.dispatchEvent(new Event('scroll', { bubbles: true }));
  },
};

export const SharedExecutionSettings: Story = {
  beforeEach: () => {
    const meta = document.createElement('meta');
    meta.name = 'studio-workspace';
    meta.content = 'true';
    document.head.append(meta);
    const original = globalThis.fetch;
    let saved: Record<string, unknown> | null = null;
    globalThis.fetch = async (input, init) => {
      if (!String(input).endsWith('/__studio/run/settings')) return original(input, init);
      const defaults = {
        provider: 'openai',
        model: 'configured-model',
        baseUrl: '',
        skillsFolder: '/home/user/skills',
        connected: false,
        skills: [],
      };
      if (init?.method === 'POST') saved = { ...defaults, ...JSON.parse(String(init.body)) };
      return Response.json(saved ?? defaults);
    };
    return () => {
      globalThis.fetch = original;
      meta.remove();
    };
  },
  play: async ({ canvasElement }) => {
    await openGuide(canvasElement, 'App settings');
    await userEvent.click(within(document.body).getByRole('tab', { name: 'Models & skills' }));
    const dialog = within(document.body).getByRole('dialog', { name: 'App settings' });
    await expect(await within(dialog).findByRole('textbox', { name: 'Model' })).toHaveValue('configured-model');
    await expect(within(dialog).getByRole('textbox', { name: /Local folder path/ })).toHaveValue('/home/user/skills');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save settings & scan skills' }));
    await expect(await within(dialog).findByText(/Settings saved/)).toBeVisible();
    dialog.querySelector('[aria-label="Shared execution settings"]')?.scrollIntoView({ block: 'start' });
  },
};

export const ExecutionSettingsError: Story = {
  beforeEach: () => {
    const meta = document.createElement('meta');
    meta.name = 'studio-workspace';
    meta.content = 'true';
    document.head.append(meta);
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) =>
      String(input).endsWith('/__studio/run/settings')
        ? Response.json(
            { error: 'Could not load execution settings. Your saved defaults remain unchanged.' },
            { status: 503 },
          )
        : original(input, init);
    return () => {
      globalThis.fetch = original;
      meta.remove();
    };
  },
  play: async ({ canvasElement }) => {
    await openGuide(canvasElement, 'App settings');
    await userEvent.click(within(document.body).getByRole('tab', { name: 'Models & skills' }));
    await expect(await within(document.body).findByRole('alert')).toHaveTextContent(
      'Could not load execution settings',
    );
    await expect(within(document.body).getByRole('button', { name: 'Retry loading settings' })).toBeVisible();
    within(document.body).getByRole('alert').scrollIntoView({ block: 'nearest' });
  },
};

export const ExecutionSettingsLoading: Story = {
  beforeEach: () => {
    const meta = document.createElement('meta');
    meta.name = 'studio-workspace';
    meta.content = 'true';
    document.head.append(meta);
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) =>
      String(input).endsWith('/__studio/run/settings') ? new Promise<Response>(() => {}) : original(input, init);
    return () => {
      globalThis.fetch = original;
      meta.remove();
    };
  },
  play: async ({ canvasElement }) => {
    await openGuide(canvasElement, 'App settings');
    await userEvent.click(within(document.body).getByRole('tab', { name: 'Models & skills' }));
    await expect(await within(document.body).findByRole('status')).toHaveTextContent('Loading execution settings');
    within(document.body).getByRole('status').scrollIntoView({ block: 'nearest' });
  },
};

function ContextualSettingsEntry() {
  const education = useShortcutEducation();
  const [draft, setDraft] = useState('My in-progress user message');
  return (
    <div className="studio min-h-dvh space-y-4 bg-background p-6 text-foreground">
      <h2 className="text-lg font-semibold">Single run setup</h2>
      <Input aria-label="Pending run input" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <Button onClick={() => education.open('settings', 'execution')}>Connection settings</Button>
    </div>
  );
}

export const ContextualExecutionSettings: Story = {
  beforeEach: SharedExecutionSettings.beforeEach,
  render: () => (
    <ShortcutEducation>
      <ContextualSettingsEntry />
    </ShortcutEducation>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Connection settings' }));
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'App settings' }));
    await expect(dialog.getByRole('tab', { name: 'Models & skills' })).toHaveAttribute('aria-selected', 'true');
    const model = await dialog.findByRole('textbox', { name: 'Model' });
    await userEvent.clear(model);
    await waitFor(() => expect(model).toHaveValue(''));
    await userEvent.type(model, 'pending-model');
    await waitFor(() => expect(model).toHaveValue('pending-model'));
    await userEvent.click(dialog.getByRole('tab', { name: 'Appearance & editing' }));
    await expect(dialog.getByRole('switch', { name: 'Compact toolbars' })).toBeVisible();
    await userEvent.click(dialog.getByRole('tab', { name: 'Models & skills' }));
    await expect(dialog.getByRole('textbox', { name: 'Model' })).toHaveValue('pending-model');
    await userEvent.click(dialog.getByRole('button', { name: 'Save settings & scan skills' }));
    await expect(await dialog.findByText(/Settings saved/)).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(within(document.body).queryByRole('dialog', { name: 'App settings' })).not.toBeInTheDocument(),
    );
    await expect(await canvas.findByRole('textbox', { name: 'Pending run input' })).toHaveValue(
      'My in-progress user message',
    );
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Connection settings' })).toHaveFocus());
    await userEvent.click(canvas.getByRole('button', { name: 'Connection settings' }));
    await expect(await within(document.body).findByRole('textbox', { name: 'Model' })).toHaveValue('pending-model');
  },
};
