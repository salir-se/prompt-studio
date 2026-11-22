import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { usePanelState } from '../hooks/use-panel-state';
import { PromptDesignPanel } from '../panels/PromptDesignPanel';
import { runRootVerification, VerificationPanel } from '../panels/VerificationPanel';
import { StudioPanelFocus } from './StudioPanelFocus';
import { STORY_ROOT } from './studio-story-fixtures';

function ReviewWorkspace() {
  const panels = usePanelState();
  return (
    <div className="studio h-dvh bg-background text-foreground">
      <main inert={panels.modal} className="p-6">
        <button type="button" onClick={() => panels.openPanel('verify')}>
          Review prompt
        </button>
      </main>
      <StudioPanelFocus modal={panels.modal}>
        {panels.activePanel === 'verify' && (
          <VerificationPanel
            root={STORY_ROOT}
            text="Missing expected sections."
            result={runRootVerification(STORY_ROOT, 'Missing expected sections.')}
            onSaveText={async () => {}}
            onClose={panels.closePanel}
          />
        )}
      </StudioPanelFocus>
    </div>
  );
}

function DesignWorkspace() {
  const panels = usePanelState();
  const [design, setDesign] = useState(STORY_ROOT.design!);
  return (
    <div className="studio h-dvh bg-background text-foreground">
      <main inert={panels.modal} className="p-6">
        <button type="button" onClick={() => panels.openPanel('design')}>
          Design prompt
        </button>
      </main>
      <StudioPanelFocus modal={panels.modal}>
        {panels.activePanel === 'design' && (
          <PromptDesignPanel
            design={design}
            text={STORY_ROOT.text ?? ''}
            onSave={async (next) => setDesign(next)}
            onClose={panels.closePanel}
          />
        )}
      </StudioPanelFocus>
    </div>
  );
}

const meta = {
  title: 'Prompts/PromptStudio/PanelFocus',
  parameters: { layout: 'fullscreen' },
  render: () => <ReviewWorkspace />,
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ResponsiveReview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Review prompt' }));
    canvas.getByRole('button', { name: /^Close$/ }).focus();
    await userEvent.tab({ shift: true });
    const covered = window.matchMedia('(max-width: 1279px)').matches;
    expect(!!document.activeElement?.closest('[data-studio-panels]')).toBe(covered);
    canvas.getByRole('button', { name: /^Close$/ }).focus();
    await userEvent.keyboard('{Control>}\u007bEnter\u007d{/Control}');
    expect(canvas.getByRole('textbox', { name: 'Verification prompt source' })).toHaveFocus();
  },
};

export const DesignShortcuts: Story = {
  render: () => <DesignWorkspace />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Design prompt' }));
    const tools = canvas.getByLabelText('Available tools');
    await userEvent.clear(tools);
    await userEvent.type(tools, 'search_accounts, save_account');
    expect(tools).toHaveValue('search_accounts, save_account');
    await userEvent.keyboard('{Control>}s{/Control}');
    await expect(canvas.getByRole('status')).toHaveTextContent('Prompt design saved and ready.');
  },
};
