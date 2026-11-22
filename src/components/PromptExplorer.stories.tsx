import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { useExplorerState } from '../hooks/use-explorer-state';
import { PromptExplorer } from './PromptExplorer';
import { PromptOutline } from './PromptOutline';
import { Sidebar } from './Sidebar';
import { STORY_ROOT, STORY_TREE } from './studio-story-fixtures';

function ExplorerStory({ empty = false }: { empty?: boolean }) {
  const explorer = useExplorerState();
  const [selected, select] = useState(`section:${STORY_TREE.children[0].id}`);
  return (
    <div className="studio flex h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border p-3">
        <button type="button" onClick={explorer.toggle} aria-expanded={explorer.open}>
          Toggle prompt explorer
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <PromptExplorer open={explorer.open} drawer={explorer.drawer} onClose={explorer.close}>
          <Sidebar
            catalog={empty ? [] : [STORY_ROOT]}
            selectedRootId={STORY_ROOT.id}
            selectedVariantSymbol={undefined}
            onSelectRoot={fn()}
            onSelectVariant={fn()}
            canCreatePrompt
            onCreatePrompt={fn()}
            outline={
              !empty && (
                <PromptOutline
                  sections={STORY_TREE.children}
                  selectedNodeId={selected}
                  onSelect={select}
                  onEdit={fn()}
                  onAddAfter={fn()}
                  onAddChild={fn()}
                  onMove={fn()}
                  onRemove={fn()}
                />
              )
            }
          />
        </PromptExplorer>
        <main className="min-w-0 flex-1 p-5">
          <label className="grid gap-2 text-sm">
            Prompt draft
            <textarea defaultValue="Unapplied writing stays intact while browsing." />
          </label>
        </main>
      </div>
    </div>
  );
}
const meta = {
  title: 'Prompts/PromptStudio/Tree drawer',
  component: ExplorerStory,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ExplorerStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Docked: Story = {};
export const Empty: Story = { args: { empty: true } };
export const MobileDrawer: Story = {
  parameters: { viewport: { defaultViewport: 'iphoneSE' } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Toggle prompt explorer' }));
    await expect(within(document.body).getByRole('searchbox', { name: 'Find a prompt' })).toHaveFocus();
  },
};
export const MobileNoMatches: Story = {
  ...MobileDrawer,
  play: async (context) => {
    await MobileDrawer.play?.(context);
    await userEvent.type(within(document.body).getByRole('searchbox', { name: 'Find a prompt' }), 'missing');
  },
};
