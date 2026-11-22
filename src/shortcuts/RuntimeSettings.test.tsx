// @module-tag dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import { ShortcutEducation } from './ShortcutEducation';
import { useShortcutEducation } from './shortcut-context';

vi.mock('../prompt-repo/prompt-repo-client', () => ({ studioJson: vi.fn() }));

const settings = {
  provider: 'openai',
  model: 'configured-model',
  baseUrl: '',
  skillsFolder: '/skills',
  skills: [],
  connected: false,
};
function SettingsButton() {
  const education = useShortcutEducation();
  return (
    <button type="button" onClick={() => education.open('settings', 'execution')}>
      Settings
    </button>
  );
}
function app() {
  document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
  return render(
    <ShortcutEducation>
      <SettingsButton />
    </ShortcutEducation>,
  );
}
afterEach(() => {
  document.querySelector('meta[name="studio-workspace"]')?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('configures shared execution defaults in app Settings, retaining fields on errors and protecting unsaved changes', async () => {
  vi.mocked(studioJson)
    .mockResolvedValueOnce(settings)
    .mockRejectedValueOnce(new Error('Settings are unavailable'))
    .mockResolvedValueOnce({ ...settings, model: 'updated-model' });
  const event = vi.fn();
  window.addEventListener('studio:run-settings-changed', event);
  const confirm = vi.fn().mockReturnValue(false);
  vi.stubGlobal('confirm', confirm);
  app();
  const openSettings = screen.getByRole('button', { name: 'Settings' });
  fireEvent.click(openSettings);
  const model = await screen.findByRole('textbox', { name: 'Model' });
  expect(model).toHaveValue('configured-model');
  fireEvent.change(model, { target: { value: 'updated-model' } });
  fireEvent.click(openSettings);
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.keyDown(model, { key: 'Escape' });
  expect(confirm).toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'App settings' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save settings & scan skills' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Settings are unavailable');
  expect(model).toHaveValue('updated-model');
  fireEvent.click(screen.getByRole('button', { name: 'Save settings & scan skills' }));
  await waitFor(() => expect(event).toHaveBeenCalledOnce());
  expect(event.mock.calls[0][0].detail.model).toBe('updated-model');
  confirm.mockClear();
  fireEvent.keyDown(model, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'App settings' })).not.toBeInTheDocument());
  expect(confirm).not.toHaveBeenCalled();
  window.removeEventListener('studio:run-settings-changed', event);
});

it('protects pending connection saves and keeps API keys out of device preferences', async () => {
  let finish!: (settings: typeof initial) => void;
  const initial = settings;
  vi.mocked(studioJson)
    .mockResolvedValueOnce(initial)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const confirm = vi.fn();
  vi.stubGlobal('confirm', confirm);
  app();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  const model = await screen.findByRole('textbox', { name: 'Model' });
  const key = screen.getByLabelText(/API key/);
  fireEvent.change(key, { target: { value: 'session-only-secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save settings & scan skills' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  fireEvent.keyDown(model, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'App settings' })).toBeVisible();
  expect(confirm).not.toHaveBeenCalled();
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  finish(initial);
  await waitFor(() => expect(key).toHaveValue(''));
  expect(Object.values(localStorage).join('')).not.toContain('session-only-secret');
  expect(JSON.parse(vi.mocked(studioJson).mock.calls.at(-1)![1]!.body!)).toMatchObject({
    apiKey: 'session-only-secret',
  });
});

it('opens the requested model settings and keeps pending fields while browsing appearance', async () => {
  vi.mocked(studioJson).mockResolvedValue(settings);
  app();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(await screen.findByRole('tab', { name: 'Models & skills' })).toHaveAttribute('aria-selected', 'true');
  const model = await screen.findByRole('textbox', { name: 'Model' });
  fireEvent.change(model, { target: { value: 'my-pending-model' } });
  const appearance = screen.getByRole('tab', { name: 'Appearance & editing' });
  fireEvent.mouseDown(appearance, { button: 0 });
  fireEvent.click(appearance);
  expect(screen.getByRole('switch', { name: 'Compact toolbars' })).toBeVisible();
  const execution = screen.getByRole('tab', { name: 'Models & skills' });
  fireEvent.mouseDown(execution, { button: 0 });
  fireEvent.click(execution);
  expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('my-pending-model');
  expect(studioJson).toHaveBeenCalledTimes(1);
});
