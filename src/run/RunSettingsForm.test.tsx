// @module-tag dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { RunSettingsForm } from './RunSettingsForm';
import { RUN_SETTINGS } from './run-fixtures';

afterEach(cleanup);
it('saves a selected skills folder, clears the credential and preserves pending edits across parent renders', async () => {
  const save = vi.fn();
  function Settings() {
    const [settings, setSettings] = useState(RUN_SETTINGS);
    return (
      <RunSettingsForm
        settings={settings}
        busy={false}
        onDirtyChange={() => {}}
        onSave={async (value) => {
          save(value);
          setSettings({ ...settings, ...value });
          return true;
        }}
      />
    );
  }
  const view = render(<Settings />);
  fireEvent.change(screen.getByLabelText(/API key/), { target: { value: 'secret-in-memory' } });
  fireEvent.change(screen.getByLabelText('Local folder path'), { target: { value: '/pending/skills' } });
  view.rerender(<Settings />);
  expect(screen.getByLabelText('Local folder path')).toHaveValue('/pending/skills');
  fireEvent.click(screen.getByRole('button', { name: 'Save settings & scan skills' }));
  await screen.findByText('Settings saved. Skills were scanned from this folder.');
  expect(screen.getByLabelText(/API key/)).toHaveValue('');
  expect(save).toHaveBeenCalledWith({
    skillsFolder: '/pending/skills',
    provider: 'openai',
    model: 'configured-model',
    baseUrl: '',
    apiKey: 'secret-in-memory',
  });
});

it.each(['zai', 'openai', 'anthropic', 'openrouter'] as const)(
  'keeps %s on its predefined endpoint with the URL override hidden by default',
  async (provider) => {
    const save = vi.fn().mockResolvedValue(true);
    render(
      <RunSettingsForm settings={{ ...RUN_SETTINGS, provider }} busy={false} onDirtyChange={() => {}} onSave={save} />,
    );
    expect(screen.getByLabelText(/^API base URL/)).not.toBeVisible();
    expect(screen.getByLabelText(/^API key/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings & scan skills' }));
    await screen.findByText('Settings saved. Skills were scanned from this folder.');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ provider, baseUrl: '' }));
  },
);

it('lets advanced users edit and collapse an endpoint override without losing or silently applying it', async () => {
  const save = vi.fn().mockResolvedValue(true);
  render(<RunSettingsForm settings={RUN_SETTINGS} busy={false} onDirtyChange={() => {}} onSave={save} />);
  const advanced = screen.getByText('Advanced connection settings', { exact: true });
  fireEvent.click(advanced);
  const endpoint = screen.getByLabelText(/^API base URL/);
  expect(endpoint).toBeVisible();
  fireEvent.change(endpoint, { target: { value: 'https://gateway.example.test/v1' } });
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'pending-model' } });
  expect(endpoint).toBeVisible();
  fireEvent.change(endpoint, { target: { value: '' } });
  expect(endpoint).toBeVisible();
  fireEvent.change(endpoint, { target: { value: 'https://gateway.example.test/v1' } });
  fireEvent.click(advanced);
  expect(endpoint).not.toBeVisible();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save settings & scan skills' }));
  await screen.findByText('Settings saved. Skills were scanned from this folder.');
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ baseUrl: 'https://gateway.example.test/v1', model: 'pending-model' }),
  );
});

it('keeps a compatible endpoint visible and preserves its override when changing providers', () => {
  render(<RunSettingsForm settings={RUN_SETTINGS} busy={false} onDirtyChange={() => {}} onSave={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai-compat' } });
  const endpoint = screen.getByLabelText(/^API base URL/);
  expect(endpoint).toBeVisible();
  fireEvent.change(endpoint, { target: { value: 'http://localhost:11434/v1' } });
  fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } });
  expect(screen.getByLabelText(/^API base URL/)).toBeVisible();
  expect(screen.getByLabelText(/^API base URL/)).toHaveValue('http://localhost:11434/v1');
});

it('reveals an existing custom endpoint so it cannot be mistaken for a provider default', () => {
  render(
    <RunSettingsForm
      settings={{ ...RUN_SETTINGS, baseUrl: 'https://gateway.example.test/v1' }}
      busy={false}
      onDirtyChange={() => {}}
      onSave={vi.fn()}
    />,
  );
  expect(screen.getByText('Advanced connection settings', { exact: true })).toBeInTheDocument();
  expect(screen.getByLabelText(/^API base URL/)).toBeVisible();
  expect(screen.getByLabelText(/^API base URL/)).toHaveValue('https://gateway.example.test/v1');
});
