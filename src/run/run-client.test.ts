// @module-tag pure
import { expect, it } from 'vitest';
import { promptVariables, providerConnected } from './run-client';
import { RUN_SETTINGS } from './run-fixtures';

it('uses the renderer variable grammar and the selected provider’s credential state', () => {
  expect(promptVariables('{{ subject }} {literal} {{subject}}')).toEqual(['subject']);
  expect(providerConnected(RUN_SETTINGS, 'openai')).toBe(true);
  expect(providerConnected(RUN_SETTINGS, 'anthropic')).toBe(false);
  expect(providerConnected({ ...RUN_SETTINGS, connected: false, connectedProviders: ['anthropic'] }, 'anthropic')).toBe(
    true,
  );
});
