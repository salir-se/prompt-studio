import './index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { ProjectPicker } from './ProjectPicker';

/**
 * ProjectPicker stories (ADR-235) — the configuration picker's states: closed trigger, the open
 * popover's project rows (with the Reset two-click confirm), and the New-configuration form with
 * the "Start from" baseline select. The picker is pure and prop-driven, so every story feeds
 * static props and a render-wide container that mimics the top bar.
 */

const BASELINES = [
  {
    id: 'default',
    label: 'Your prompts',
    description: 'The shipped prompt set.',
    positioning: 'shipped' as const,
  },
  {
    id: 'job-seeker-personal-broker',
    label: 'Job Seeker — personal broker (reference)',
    description: 'Calibration reference configuration.',
    positioning: 'reference' as const,
  },
  {
    id: 'it-consultant-network-first',
    label: 'IT Consultant — network first (reference)',
    description: 'Calibration reference configuration.',
    positioning: 'reference' as const,
  },
  {
    id: 'software-product-offer-expert',
    label: 'Software Product — offer expert (reference)',
    description: 'Calibration reference configuration.',
    positioning: 'reference' as const,
  },
];

const meta = {
  title: 'Prompt Studio/ProjectPicker',
  component: ProjectPicker,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ProjectPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Trigger: Story = {
  args: {
    projects: [
      { id: 'default', name: 'Default' },
      { id: 'job-seeker-trial', name: 'Job Seeker trial' },
    ],
    activeId: 'default',
    baselines: BASELINES,
    onSwitch: () => {},
    onCreate: () => {},
    onRename: () => {},
    onDuplicate: () => {},
    onDelete: () => {},
    onReset: () => {},
  },
};

export const MenuOpen: Story = {
  ...Trigger,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('project-picker-trigger'));
    await expect(within(document.body).getByRole('dialog', { name: 'Projects' })).toBeVisible();
  },
};

export const NewConfigurationForm: Story = {
  ...Trigger,
  play: async (context) => {
    await MenuOpen.play?.(context);
    await userEvent.click(within(document.body).getByRole('button', { name: 'New configuration' }));
    await expect(within(document.body).getByRole('textbox', { name: 'Configuration name' })).toBeVisible();
  },
};

export const LongConfigurationNames: Story = {
  ...Trigger,
  args: {
    ...Trigger.args,
    projects: [
      { id: 'default', name: 'Default' },
      ...Array.from({ length: 18 }, (_, index) => ({
        id: `configuration-${index}`,
        name: `Research configuration ${index + 1} — long customer-specific instructions`,
      })),
    ],
  },
  play: async (context) => {
    await MenuOpen.play?.(context);
    const menu = within(document.body).getByRole('dialog', { name: 'Projects' });
    const bounds = menu.getBoundingClientRect();
    await expect(bounds.left).toBeGreaterThanOrEqual(0);
    await expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
    await expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
    await expect(menu.scrollHeight).toBeGreaterThan(menu.clientHeight);
  },
};
