// @module-tag dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import { announceRunSettings } from '../run/run-settings-events';
import { HelpPanel } from './HelpPanel';

vi.mock('../prompt-repo/prompt-repo-client', () => ({ studioJson: vi.fn() }));
const config = {
  provider: 'openai' as const,
  model: 'prompt-model',
  baseUrl: '',
  skillsFolder: '',
  skills: [],
  connected: true,
  connectedProviders: ['openai' as const],
};
afterEach(() => {
  document.querySelector('meta[name="studio-workspace"]')?.remove();
  vi.resetAllMocks();
});
function app() {
  document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
  return render(
    <HelpPanel
      context={{ manifestName: 'Writing toolkit', rootCount: 2, selectedRootTitle: 'Research' }}
      onClose={() => {}}
    />,
  );
}
it('uses shared settings without a second key, saves a separate Help model and labels answers', async () => {
  // Given: Help opens with the app model already connected.
  let saved: any = config;
  vi.mocked(studioJson).mockImplementation(async (path, init) => {
    if (path === '/__studio/run/settings' && init?.method === 'POST') {
      saved = { ...saved, ...JSON.parse(init.body!) };
      return saved;
    }
    if (path === '/__studio/run/help')
      return { text: 'Open Project → Versions.', provider: 'openai', model: saved.helpModel?.model ?? saved.model };
    return saved;
  });
  app();
  expect(await screen.findByText('OpenAI · prompt-model')).toBeVisible();
  expect(screen.queryByLabelText('z.ai API key')).not.toBeInTheDocument();
  // When: a question is asked, then Help alone selects a smaller model.
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask the help assistant' }), {
    target: { value: 'How do I save?' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Ask$/ }));
  expect(await screen.findByText('Open Project → Versions.')).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use model from App settings' }));
  expect(screen.getByText('Quick guide · no connection needed').closest('details')).not.toHaveAttribute('open');
  fireEvent.change(screen.getByRole('textbox', { name: /^Model$/ }), { target: { value: 'help-model' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Help model' }));
  await waitFor(() => expect(saved.helpModel?.model).toBe('help-model'));
  // Then: only the Help override was saved and both question/model identity are retained.
  expect(saved.model).toBe('prompt-model');
  expect(
    vi
      .mocked(studioJson)
      .mock.calls.find(([path, init]) => path === '/__studio/run/settings' && init?.method === 'POST')?.[1]?.body,
  ).toBe(JSON.stringify({ helpModel: { provider: 'openai', model: 'help-model' } }));
  expect(screen.getByText('Open Project → Versions.')).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask the help assistant' }), {
    target: { value: 'And another question?' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Ask$/ }));
  await waitFor(() => expect(screen.getAllByText('OpenAI · help-model').length).toBeGreaterThan(1));
  expect(localStorage.getItem('prompt-studio:help:zai-key:v1')).toBeNull();
});
it('shows connection errors with retry and follows app-model changes while using shared settings', async () => {
  // Given: the initial settings load fails.
  vi.mocked(studioJson).mockRejectedValueOnce(new Error('Settings unavailable')).mockResolvedValue(config);
  app();
  expect(await screen.findByRole('alert')).toHaveTextContent('Settings unavailable');
  // When: settings are retried and subsequently changed by App settings.
  fireEvent.click(screen.getByRole('button', { name: 'Retry model settings' }));
  expect(await screen.findByText('OpenAI · prompt-model')).toBeVisible();
  announceRunSettings({ ...config, model: 'updated-prompt-model' });
  // Then: Help follows the live shared choice without collecting a key.
  expect(await screen.findByText('OpenAI · updated-prompt-model')).toBeVisible();
});

it('keeps a newer App settings update when an older initial load finishes later', async () => {
  // Given: Help is still loading its first snapshot.
  let finish!: (value: typeof config) => void;
  vi.mocked(studioJson).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  app();
  // When: App settings changes before the old request returns.
  announceRunSettings({ ...config, model: 'newer-model' });
  expect(await screen.findByText('OpenAI · newer-model')).toBeVisible();
  finish(config);
  // Then: the stale response cannot replace the visible/effective model.
  await waitFor(() => expect(screen.queryByText('OpenAI · prompt-model')).not.toBeInTheDocument());
  expect(screen.getByText('OpenAI · newer-model')).toBeVisible();
});
