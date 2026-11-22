// @module-tag integration
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { LocalRunStore } from './local-store';
import { RunSettingsStore } from './run-settings';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => fs.rm(folder, { recursive: true, force: true })));
});
it('keeps settings repairable after the skills folder disappears', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'studio-settings-'));
  folders.push(directory);
  const folder = path.join(directory, 'skills');
  await fs.mkdir(folder);
  const settings = new RunSettingsStore(new LocalRunStore(directory), {
    apiKey: 'secret',
    baseUrl: 'https://example.com/v1',
  });
  await settings.update({ skillsFolder: folder });
  await fs.rm(folder, { recursive: true });
  const described = await settings.describe();
  expect(described.skills).toEqual([]);
  expect(described.skillsError).toContain('skills folder');
  expect(described.baseUrl).toBe('https://example.com/v1');
  expect((await settings.update({ helpModel: { provider: 'zai', model: 'help-model' } })).helpModel?.model).toBe(
    'help-model',
  );
  expect(described.connectedProviders).toEqual(['zai']);
  expect(JSON.stringify(described)).not.toContain('secret');
  expect((await settings.update({ skillsFolder: '' })).skillsError).toBeUndefined();
});
it('does not silently connect a configured credential to a different saved endpoint after restart', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'studio-endpoint-'));
  folders.push(directory);
  const files = new LocalRunStore(directory);
  const settings = new RunSettingsStore(files);
  await settings.update({ provider: 'zai', baseUrl: 'http://localhost:9999', apiKey: 'local-only' });
  const restarted = new RunSettingsStore(files, { apiKey: 'remote-key', baseUrl: 'https://api.z.ai/api/anthropic' });
  const view = await restarted.describe();
  expect(view.baseUrl).toBe('http://localhost:9999');
  expect(view.connected).toBe(false);
  expect(view.connectedProviders).toEqual([]);
  expect(restarted.credential('zai')).toBeUndefined();
});

it('keeps a Help override independent from the prompt model and allows returning to shared settings', async () => {
  // Given: an app model and a separate Help provider/model choice.
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'studio-help-settings-'));
  folders.push(directory);
  const files = new LocalRunStore(directory);
  const settings = new RunSettingsStore(files);
  await settings.update({ provider: 'openai', model: 'prompt-model', apiKey: 'private-key' });
  await settings.update({ helpModel: { provider: 'openai', model: 'help-model' } });
  // When: the prompt model changes and settings are loaded after restart.
  await settings.update({ model: 'another-prompt-model' });
  const restarted = new RunSettingsStore(files);
  // Then: Help retains its own choice; clearing it restores inheritance without changing prompts.
  expect(await restarted.describe()).toMatchObject({
    provider: 'openai',
    model: 'another-prompt-model',
    helpModel: { provider: 'openai', model: 'help-model' },
  });
  expect(await restarted.update({ helpModel: null })).toMatchObject({ model: 'another-prompt-model', helpModel: null });
  expect(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).not.toContain('private-key');
});
