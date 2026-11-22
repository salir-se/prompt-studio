// @module-tag dom
import { describe, expect, it, vi } from 'vitest';
import { callCommand, controlTokenFilePath, discoverToken } from './client';
import { CliUsageError, formatResult, parseArgs } from './commands';

/**
 * The CLI is an RPC FORMATTER (task #19): every subcommand maps to exactly one control-API call,
 * and failures are readable diagnostics. Parsing/formatting are pure (table-driven); the client
 * is covered with a stubbed fetch, including the two failure shapes CLI users hit first — studio
 * not running (refused connection) and editor tab not open (503).
 */

describe('parseArgs', () => {
  it('maps every subcommand to its control call', () => {
    expect(parseArgs(['docs'])).toMatchObject({ command: 'listDocuments' });
    expect(parseArgs(['read', 'scout'])).toMatchObject({ command: 'readDocument', args: { rootId: 'scout' } });
    expect(parseArgs(['read', 'critic-outbound-agent-loop', '--variant', 'CRITIC_PROMPT'])).toMatchObject({
      command: 'readDocument',
      args: { rootId: 'critic-outbound-agent-loop', variantSymbol: 'CRITIC_PROMPT' },
    });
    expect(parseArgs(['open', 'scout'])).toMatchObject({ command: 'openDocument' });
    expect(parseArgs(['edit', 'scout', '--file', 'p.md', '--message', 'tweak'])).toMatchObject({
      command: 'editDocument',
      args: { rootId: 'scout', source: 'p.md', message: 'tweak' },
    });
    expect(parseArgs(['configs'])).toMatchObject({ command: 'listConfigurations' });
    expect(parseArgs(['new-config', 'Trial', '--from', 'job-seeker-personal-broker'])).toMatchObject({
      command: 'createConfiguration',
      args: { name: 'Trial', fromBaseline: 'job-seeker-personal-broker' },
    });
    expect(parseArgs(['use-config', 'default'])).toMatchObject({
      command: 'switchConfiguration',
      args: { projectId: 'default' },
    });
    expect(parseArgs(['reset', 'scout'])).toMatchObject({ command: 'resetDocument' });
    expect(parseArgs(['history', 'scout'])).toMatchObject({ command: 'history' });
  });

  it('carries global flags and rejects unknown ones with the usage error', () => {
    expect(parseArgs(['docs', '--json', '--port', '5299', '--token', 't'])).toMatchObject({
      json: true,
      port: 5299,
      token: 't',
    });
    expect(() => parseArgs(['docs', '--nonsense'])).toThrow(CliUsageError);
    expect(() => parseArgs(['read'])).toThrow(/ps docs/);
    expect(() => parseArgs(['edit', 'scout'])).toThrow('--file PATH or --stdin');
    expect(() => parseArgs([])).toThrow(CliUsageError);
  });
});

describe('formatResult', () => {
  it('renders documents, configurations, and history for humans', () => {
    const documents = formatResult('listDocuments', [
      { id: 'scout', title: 'Scout', loadability: 'constant' },
      { id: 'critic-outbound-agent-loop', title: 'Critic', loadability: 'resolver-variants' },
    ]);
    expect(documents).toContain('scout');
    expect(documents).toContain('constant');

    const configs = formatResult('listConfigurations', {
      activeProjectId: 'default',
      projects: [
        { id: 'default', name: 'Default' },
        { id: 'trial', name: 'Trial' },
      ],
    });
    expect(configs.split('\n')[0]).toContain('*');
    expect(configs.split('\n')[1].startsWith(' ')).toBe(true);

    const history = formatResult('history', [
      { id: 'abcdef123', message: 'baseline', timestampMs: Date.UTC(2026, 7, 15) },
    ]);
    expect(history).toContain('abcdef1');
    expect(history).toContain('baseline');
  });

  it('prints read documents with their source, and passthrough JSON for the rest', () => {
    expect(formatResult('readDocument', { rootId: 'scout', text: 'TEXT', source: 'working' })).toContain(
      'TEXT\n\n— scout (working)',
    );
    expect(formatResult('openDocument', { opened: 'scout' })).toBe(JSON.stringify({ opened: 'scout' }, null, 2));
  });
});

describe('client', () => {
  it('discovers the token from the port-scoped control token file', async () => {
    expect(controlTokenFilePath(5273)).toContain('prompt-studio-control-5273.token');
    expect(await discoverToken(5273, undefined, async () => '  token-from-file  ')).toBe('token-from-file');
    expect(await discoverToken(5273, 'explicit-wins', async () => 'never-read')).toBe('explicit-wins');
  });

  it('a missing token file names the likely cause', async () => {
    await expect(discoverToken(5999)).rejects.toThrow(/studio running on that port/);
  });

  it('POSTs the RPC with the token header and returns the result', async () => {
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe('http://127.0.0.1:5273/__control/command');
      expect((init?.headers as Record<string, string>)['x-studio-token']).toBe('tk');
      expect(JSON.parse(String(init?.body))).toEqual({ command: 'listDocuments', args: {} });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { documents: [] } }),
      } as unknown as Response;
    });
    await expect(
      callCommand({ port: 5273, token: 'tk', fetchImpl: fetchImpl as unknown as typeof fetch }, 'listDocuments'),
    ).resolves.toEqual({
      documents: [],
    });
  });

  it('turns refusal, 503, and error bodies into readable diagnostics', async () => {
    const refused: typeof fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(callCommand({ port: 5273, token: 'tk', fetchImpl: refused }, 'listDocuments')).rejects.toThrow(
      'is it running',
    );

    const noTab: typeof fetch = (async () =>
      ({
        ok: false,
        status: 503,
        json: async () => ({
          ok: false,
          error: 'No editor tab is connected — open the prompt studio in a browser first.',
        }),
      }) as unknown as Response) as unknown as typeof fetch;
    await expect(callCommand({ port: 5273, token: 'tk', fetchImpl: noTab }, 'listDocuments')).rejects.toThrow(
      'open the prompt studio',
    );

    const rejected: typeof fetch = (async () =>
      ({
        ok: false,
        status: 200,
        json: async () => ({ ok: false, error: 'Open "scout" first (openDocument).' }),
      }) as unknown as Response) as unknown as typeof fetch;
    await expect(callCommand({ port: 5273, token: 'tk', fetchImpl: rejected }, 'editDocument')).rejects.toThrow(
      'Open "scout" first',
    );
  });
});
