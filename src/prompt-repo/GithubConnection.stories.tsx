import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { GithubConnectionView } from './GithubConnection';

const meta = {
  title: 'Prompts/PromptStudio/GithubConnection',
  component: GithubConnectionView,
  args: {
    status: { configured: true, connected: false },
    device: null,
    clientId: '',
    busy: false,
    error: null,
    connect: fn(),
    disconnect: fn(),
    checkStatus: fn(),
    setClientId: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GithubConnectionView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Disconnected: Story = {};
export const Loading: Story = { args: { status: null } };
export const Setup: Story = { args: { status: { configured: false, connected: false } } };
export const AwaitingAuthorization: Story = {
  args: {
    device: {
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresAt: 4_000_000_000_000,
      interval: 5,
    },
  },
};
export const Connected: Story = {
  args: { status: { configured: true, connected: true, login: 'prompt-designer-with-a-long-account-name' } },
};
export const ConnectionFailure: Story = {
  args: { error: 'Could not connect to GitHub. Check the app setup and try again.' },
};
export const StatusFailure: Story = { args: { status: null, error: 'Could not check GitHub connection. Try again.' } };
