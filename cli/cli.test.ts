// @module-tag dom
import { describe, expect, it, vi } from 'vitest';
import { callCommand, controlTokenFilePath, discoverToken } from './client';
import { CliUsageError, formatCapabilities, formatResult, formatTargets, parseArgs } from './commands';
import { cliExitCode } from './main';

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

  it('maps the section subcommands and the generic call to their commands', () => {
    // Given / When: the section and call subcommands are parsed
    // Then: each maps to one catalog command with its args
    expect(parseArgs(['sections', 'order-status'])).toMatchObject({
      command: 'listSections',
      args: { rootId: 'order-status' },
    });
    expect(parseArgs(['section', 'order-status', 'role'])).toMatchObject({
      command: 'readSection',
      args: { rootId: 'order-status', sectionId: 'role' },
    });
    expect(parseArgs(['edit-section', 'order-status', 'role', '--stdin', '-m', 'tighten'])).toMatchObject({
      command: 'editSection',
      args: { rootId: 'order-status', sectionId: 'role', source: 'stdin', message: 'tighten' },
    });
    expect(
      parseArgs(['call', 'moveSection', '--params', '{"rootId":"o","sectionId":"role","direction":"down"}']),
    ).toMatchObject({ command: 'moveSection', args: { rootId: 'o', sectionId: 'role', direction: 'down' } });
    expect(parseArgs(['design', 'order-status', 'output'])).toMatchObject({
      command: 'getDesign',
      args: { rootId: 'order-status', sectionId: 'output' },
    });
    expect(parseArgs(['design', 'order-status'])).toMatchObject({
      command: 'getDesign',
      args: { rootId: 'order-status' },
    });
    expect(parseArgs(['patterns'])).toMatchObject({ command: 'listWorkflowPatterns', args: {} });
    expect(parseArgs(['checks', 'order-status', 'tools'])).toMatchObject({
      command: 'listChecks',
      args: { rootId: 'order-status', sectionId: 'tools' },
    });
    expect(parseArgs(['findings', 'order-status'])).toMatchObject({
      command: 'getFindings',
      args: { rootId: 'order-status' },
    });
    expect(() => parseArgs(['section', 'order-status'])).toThrow('needs a section id');
    expect(() => parseArgs(['call', 'listSections', '--params', '[1]'])).toThrow('--params needs a JSON object');
    expect(
      formatResult('listSections', {
        sections: [
          { id: 'tools', title: 'tools', depth: 1, delimiter: 'xml-tag' },
          { id: 'tools/retry', title: 'retry', depth: 2, delimiter: 'xml-tag' },
        ],
      }),
    ).toBe('tools  tools  (xml-tag)\n  tools/retry  retry  (xml-tag)');
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

describe('remote-control flags and subcommands', () => {
  it('parses targets, capabilities, --target, --timeout, --transport and -m', () => {
    // Given / When / Then: the new subcommands are answered by the Studio, not a tab
    expect(parseArgs(['targets', '--json'])).toMatchObject({ kind: 'targets', json: true, transport: 'ws' });
    expect(parseArgs(['capabilities'])).toMatchObject({ kind: 'capabilities' });
    // And: editor commands carry the routing flags; WebSocket is the default transport
    expect(parseArgs(['docs', '--target', 'tab-1', '--timeout', '5000'])).toMatchObject({
      kind: 'command',
      command: 'listDocuments',
      target: 'tab-1',
      timeoutMs: 5000,
      transport: 'ws',
    });
    expect(parseArgs(['docs', '--transport', 'http'])).toMatchObject({ transport: 'http' });
    expect(parseArgs(['edit', 'scout', '--stdin', '-m', 'msg'])).toMatchObject({ args: { message: 'msg' } });
    // And: invalid values are usage errors
    expect(() => parseArgs(['docs', '--transport', 'sse'])).toThrow(CliUsageError);
    expect(() => parseArgs(['docs', '--timeout', 'soon'])).toThrow(CliUsageError);
    expect(() => parseArgs(['docs', '--port', '0'])).toThrow(CliUsageError);
  });

  it('maps failures to exit codes: no Studio is a connection failure, a lost command a timeout', () => {
    // Given / When / Then
    expect(cliExitCode({ code: 'disconnected', message: '', outcome: 'none' })).toBe(3);
    expect(cliExitCode({ code: 'timeout', message: '', outcome: 'none' })).toBe(3);
    expect(cliExitCode({ code: 'disconnected', message: '', outcome: 'unknown' })).toBe(5);
    expect(cliExitCode({ code: 'ambiguous_target', message: '' })).toBe(4);
    expect(cliExitCode({ code: 'command_failed', message: '' })).toBe(1);
  });

  it('formats targets and capabilities for humans', () => {
    expect(
      formatTargets([{ browserId: 'tab-1', ready: true, projectName: 'Default', documentId: 'scout', view: 'write' }]),
    ).toBe('tab-1  ready  Default  scout (write)');
    expect(formatTargets([])).toContain('no editor tab');
    expect(formatCapabilities([{ name: 'history', description: 'Commits.', completionLevels: ['applied'] }])).toBe(
      'history  Commits.  [applied]',
    );
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
