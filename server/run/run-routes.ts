import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LlmProvider } from '@prompt-studio/agent';
import { type } from 'arktype';
import { STUDIO_TOKEN_HEADER, validateOrigin, validateToken } from '../../src/bridge/fs-bridge';
import { toolBindingsSchema } from '../../src/mcp/binding-schema';
import type { RunProvider, RunSetup } from '../../src/run/contracts';
import { StudioMcpRegistry } from '../mcp/registry';
import type { PromptRepoRuntime } from '../prompt-repo-routes';
import { createEvaluationService } from './evaluation-service';
import { createHelpResponder } from './help-responder';
import { fingerprint, LocalRunStore } from './local-store';
import { createRunEngine, parseRunRequest } from './run-engine';
import { RunSettingsStore } from './run-settings';

const profileSchema = type({
  '+': 'reject',
  projectId: 'string > 0',
  revision: 'number.integer >= 0',
  promptPath: 'string > 0',
  profile: {
    '+': 'reject',
    provider: "'zai' | 'openai' | 'anthropic' | 'openrouter' | 'openai-compat'",
    model: 'string <= 200',
    inputs: { '[string]': 'string <= 32000' },
    userMessage: 'string <= 32000',
    skills: type('string <= 4096').array().atMostLength(16),
    'tools?': toolBindingsSchema,
  },
});

async function body(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 1024 * 1024) throw new Error('The run request exceeds 1 MiB.');
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new Error('Supply a valid JSON request.');
  }
}
function send(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

export function createRunHandler(options: {
  runtime: PromptRepoRuntime;
  directory: string;
  studioToken: string;
  allowedOrigins: readonly string[];
  apiKey?: string;
  baseUrl?: string;
  createProvider?: (provider: RunProvider, config: { apiKey: string; baseUrl?: string }) => LlmProvider;
  budget?: number;
  settings?: RunSettingsStore;
}) {
  const files = new LocalRunStore(options.directory);
  const settings =
    options.settings ?? new RunSettingsStore(files, { apiKey: options.apiKey, baseUrl: options.baseUrl });
  const help = createHelpResponder(settings, options.createProvider);
  const mcp = new StudioMcpRegistry(files);
  const engine = createRunEngine({ ...options, settings, mcp });
  const evaluations = createEvaluationService({ engine, directory: options.directory });
  const profileKey = (projectId: string, promptPath: string) =>
    `${files.project(projectId)}/profiles/${fingerprint(promptPath)}.json`;
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const prefix = '/__studio/run';
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return false;
    const header = (name: string) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    if (!validateOrigin(header('origin'), options.allowedOrigins)) {
      send(res, 403, { error: 'Forbidden.' });
      return true;
    }
    if (!validateToken(header(STUDIO_TOKEN_HEADER), options.studioToken)) {
      send(res, 401, { error: 'Unauthorized.' });
      return true;
    }
    const operation = url.pathname.slice(prefix.length);
    try {
      if (!['GET', 'POST'].includes(req.method ?? '')) {
        send(res, 405, { error: 'Method not allowed.' });
        return true;
      }
      const raw = req.method === 'POST' ? await body(req) : undefined;
      if (operation === '/help' && req.method === 'POST') {
        const controller = new AbortController();
        const cancel = () => {
          if (!res.writableEnded) controller.abort();
        };
        res.once('close', cancel);
        try {
          send(res, 200, await help(raw, controller.signal));
        } finally {
          res.off('close', cancel);
        }
        return true;
      }
      if (operation === '/mcp-servers') {
        if (req.method === 'GET') send(res, 200, { servers: await mcp.list() });
        else {
          const input = type({
            '+': 'reject',
            action: "'save' | 'discover' | 'remove'",
            'server?': 'unknown',
            'id?': /^[a-f0-9-]{36}$/i,
          })(raw);
          if (input instanceof type.errors || (input.action !== 'save' && !input.id))
            throw new Error('Supply a valid MCP server operation.');
          const servers =
            input.action === 'save'
              ? await mcp.save(input.server)
              : input.action === 'discover'
                ? await mcp.discover(input.id ?? '')
                : await mcp.remove(input.id ?? '');
          send(res, 200, { servers });
        }
        return true;
      }
      if (operation === '/settings') {
        send(res, 200, {
          ...(req.method === 'GET' ? await settings.describe() : await settings.update(raw)),
          mcpServers: await mcp.list(),
        });
        return true;
      }
      const evaluated = await evaluations.handle(operation, req.method!, url, raw);
      if (evaluated) {
        send(res, evaluated.status, evaluated.body);
        return true;
      }
      const projectId = url.searchParams.get('projectId') ?? '';
      const promptPath = url.searchParams.get('promptPath') ?? '';
      if (operation === '/profile') {
        if (req.method === 'GET') {
          await engine.assertProject(projectId);
          send(res, 200, { profile: await files.read<RunSetup | null>(profileKey(projectId, promptPath), null) });
        } else {
          const parsed = profileSchema(raw);
          if (parsed instanceof type.errors) throw new Error('Supply a valid run setup.');
          await engine.assertProject(parsed.projectId, parsed.revision);
          await files.write(profileKey(parsed.projectId, parsed.promptPath), parsed.profile);
          send(res, 200, { profile: parsed.profile });
        }
        return true;
      }
      if (!operation && req.method === 'POST') {
        send(res, 202, { run: await engine.start(parseRunRequest(raw)) });
        return true;
      }
      if (!operation && req.method === 'GET') {
        send(res, 200, { runs: await engine.list(projectId, promptPath) });
        return true;
      }
      const match = /^\/([a-f0-9-]{36})(\/cancel)?$/i.exec(operation);
      if (match && req.method === 'GET' && !match[2]) {
        send(res, 200, { run: await engine.get(projectId, match[1]) });
        return true;
      }
      if (match?.[2] && req.method === 'POST') {
        const parsed = type({ projectId: 'string > 0', '+': 'reject' })(raw);
        if (parsed instanceof type.errors) throw new Error('Supply the run project.');
        await engine.cancel(parsed.projectId, match[1]);
        send(res, 200, { ok: true });
        return true;
      }
      send(res, 404, { error: 'Run operation not found.' });
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : 'The run operation failed.' });
    }
    return true;
  };
}
