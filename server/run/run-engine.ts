import {
  type LlmProvider,
  OneShotTruncatedError,
  registerBuiltinProviders,
  runAgent,
  runOneShot,
} from '@prompt-studio/agent';
import type { ToolInputSchema } from '@prompt-studio/prompts';
import { extractPlaceholderNames, extractPromptFileReferences, PROMPT_PLACEHOLDER_RE } from '@prompt-studio/prompts';
import { type } from 'arktype';
import { toolBindingsSchema } from '../../src/mcp/binding-schema';
import type { ToolCallTrace } from '../../src/mcp/contracts';
import type { MemoryRepository } from '../../src/prompt-repo/memory-repository';
import { projectFileIndex, readProjectFile } from '../../src/prompt-repo/project-files';
import { resolveProjectReference } from '../../src/references-resolver';
import type { RunRecord, RunRequest, RunSettings } from '../../src/run/contracts';
import { RUN_PROVIDERS } from '../../src/run/contracts';
import { type FrozenTool, StudioMcpRegistry } from '../mcp/registry';
import type { PromptRepoRuntime } from '../prompt-repo-routes';
import { fingerprint, LocalRunStore } from './local-store';
import { createStudioModelProvider, observeModelReply } from './model-provider';
import { isProcessAlive } from './process-owner';
import type { RunSettingsStore } from './run-settings';
import { captureSkills } from './skill-library';

export interface RunWorld {
  repository: MemoryRepository;
  provider: LlmProvider;
  skills: RunRecord['skills'];
  providerId: RunRequest['provider'];
  model: string;
  toolSets?: Map<string, FrozenTool[]>;
}
export interface RunEngine {
  assertProject(projectId: string, revision?: number): Promise<MemoryRepository>;
  settings(): Promise<RunSettings>;
  freeze(input: RunRequest, variants?: RunRequest[]): Promise<RunWorld>;
  prepare(input: RunRequest, world: RunWorld): Promise<RunRecord>;
  execute(input: RunRequest, world?: RunWorld): Promise<RunRecord>;
  start(input: RunRequest): Promise<RunRecord>;
  get(projectId: string, runId: string): Promise<RunRecord>;
  list(projectId: string, promptPath: string): Promise<RunRecord[]>;
  cancel(projectId: string, runId: string): Promise<void>;
}

export const runRequestSchema = type({
  '+': 'reject',
  runId: /^[a-f0-9-]{36}$/i,
  projectId: 'string > 0',
  revision: 'number.integer >= 0',
  promptPath: 'string > 0',
  source: 'string <= 200000',
  inputs: { '[string]': 'string <= 32000' },
  userMessage: 'string <= 1500000',
  skills: type('string <= 4096').array().atMostLength(16),
  provider: "'zai' | 'openai' | 'anthropic' | 'openrouter' | 'openai-compat'",
  model: 'string > 0',
  'tools?': toolBindingsSchema,
});
export function parseRunRequest(raw: unknown): RunRequest {
  const result = runRequestSchema(raw);
  if (result instanceof type.errors || result.model.length > 200 || Object.keys(result.inputs).length > 100)
    throw new Error('Supply a valid prompt run with at most 100 inputs.');
  return result;
}

interface StoredRun extends RunRecord {
  requestHash?: string;
  ownerPid?: number;
}
function requestFingerprint(input: RunRequest): string {
  return fingerprint(
    JSON.stringify({
      projectId: input.projectId,
      revision: input.revision,
      promptPath: input.promptPath,
      source: input.source,
      inputs: Object.fromEntries(Object.entries(input.inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      userMessage: input.userMessage,
      skills: input.skills,
      ...(input.tools?.length ? { tools: input.tools } : {}),
      provider: input.provider,
      model: input.model,
    }),
  );
}

export function createRunEngine(options: {
  runtime: PromptRepoRuntime;
  directory: string;
  settings: RunSettingsStore;
  createProvider?: (provider: RunRequest['provider'], config: { apiKey: string; baseUrl?: string }) => LlmProvider;
  budget?: number;
  mcp?: StudioMcpRegistry;
}): RunEngine {
  registerBuiltinProviders();
  const files = new LocalRunStore(options.directory);
  const mcp = options.mcp ?? new StudioMcpRegistry(files);
  const records = new Map<string, StoredRun>();
  const controllers = new Map<string, AbortController>();
  const starting = new Map<string, { requestHash: string; operation: Promise<RunRecord> }>();
  const pending = new Map<string, Promise<RunRecord>>();
  const cancelled = new Set<string>();
  let remaining = options.budget ?? 100;
  let active = 0;
  const key = (projectId: string, runId: string) => `${files.project(projectId)}/runs/${runId}.json`;
  const validId = (runId: string) => {
    if (!/^[a-f0-9-]{36}$/i.test(runId)) throw new Error('Choose a valid run.');
  };

  async function assertProject(projectId: string, revision?: number) {
    await options.runtime.initialize?.();
    const repository = options.runtime.repository;
    if (
      !repository ||
      repository.projectId !== projectId ||
      (revision !== undefined && repository.revision !== revision)
    )
      throw new Error('This project changed. Reload its latest saved state before running.');
    return repository;
  }
  async function freeze(input: RunRequest, variants: RunRequest[] = []): Promise<RunWorld> {
    parseRunRequest(input);
    const repository = (await assertProject(input.projectId, input.revision)).copy();
    const settings = await options.settings.value();
    const credential = options.settings.credential(input.provider);
    if (!RUN_PROVIDERS.includes(input.provider) || !credential)
      throw new Error('Connect this model provider in Run Settings first.');
    const skills = await captureSkills(settings.skillsFolder, input.skills);
    const toolSets = new Map<string, FrozenTool[]>();
    for (const request of [input, ...variants]) {
      parseRunRequest(request);
      const key = JSON.stringify(request.tools ?? []);
      if (!toolSets.has(key)) toolSets.set(key, await mcp.freeze(request.tools));
    }
    return {
      toolSets,
      repository,
      skills,
      providerId: input.provider,
      model: input.model,
      provider: createStudioModelProvider(input.provider, credential, options.createProvider),
    };
  }
  async function prepare(raw: RunRequest, world: RunWorld): Promise<RunRecord> {
    const input = parseRunRequest(raw);
    if (
      world.repository.projectId !== input.projectId ||
      world.repository.revision !== input.revision ||
      world.providerId !== input.provider ||
      world.model !== input.model ||
      JSON.stringify(world.skills.map((skill) => skill.id)) !== JSON.stringify(input.skills)
    )
      throw new Error('The run setup changed. Start again with one consistent snapshot.');
    if (input.tools?.length && !world.toolSets?.has(JSON.stringify(input.tools)))
      throw new Error('The tool setup changed. Start again with one consistent snapshot.');
    if (!/^(?:prompts\/[^/]+\.md|skills\/[^/]+\/SKILL\.md)$/.test(input.promptPath))
      throw new Error('Choose a prompt document in the open project.');
    await readProjectFile(world.repository, input.promptPath);
    for (const name of extractPlaceholderNames(input.source))
      if (!Object.hasOwn(input.inputs, name)) throw new Error(`Supply the ${name} input before running.`);
    const resolved = input.source.replace(
      new RegExp(PROMPT_PLACEHOLDER_RE.source, PROMPT_PLACEHOLDER_RE.flags),
      (_match, name: string) => input.inputs[name],
    );
    const inventory = await projectFileIndex(world.repository);
    const captured = new Map<string, RunRecord['files'][number]>();
    const load = async (text: string, documentPath: string) => {
      for (const reference of extractPromptFileReferences(text)) {
        const found = resolveProjectReference(reference.path, documentPath, inventory);
        if (found.state !== 'Found')
          throw new Error(`${reference.path}: ${found.state}. Repair this reference before running.`);
        if (!captured.has(found.path)) {
          captured.set(found.path, await readProjectFile(world.repository, found.path));
          if (captured.size > 64) throw new Error('A run can preload at most 64 project files.');
        }
      }
    };
    await load(resolved, input.promptPath);
    for (const file of captured.values()) await load(file.text, file.path);
    const references = [...captured.values()];
    const toolDefinitions = (world.toolSets?.get(JSON.stringify(input.tools ?? [])) ?? []).map((binding) => ({
      name: binding.name,
      serverName: binding.server.name,
      toolName: binding.toolName,
      mode: binding.mode,
      inputSchema: binding.tool.inputSchema,
      schemaHash: binding.schemaHash,
    }));
    const systemPrompt = [
      ...(references.length
        ? [
            '# Preloaded project files (reference data)',
            JSON.stringify(references.map(({ path, text }) => ({ path, text }))),
          ]
        : []),
      ...world.skills.flatMap((skill) => [
        `# Attached skill: ${skill.name}`,
        ...skill.files.map((file) => `## ${file.path}\n${file.text}`),
      ]),
      '# Prompt instructions',
      resolved,
    ].join('\n\n');
    if (Buffer.byteLength(systemPrompt) > 400_000)
      throw new Error('The prompt, skills and references exceed the 400 KiB run limit.');
    return {
      ...input,
      ...(toolDefinitions.length ? { toolDefinitions } : {}),
      skills: structuredClone(world.skills),
      files: references,
      systemPrompt,
      sourceHash: fingerprint(input.source),
      startedAt: new Date().toISOString(),
      status: 'running',
      output: '',
    };
  }
  async function get(projectId: string, runId: string): Promise<RunRecord> {
    validId(runId);
    await assertProject(projectId);
    const target = key(projectId, runId);
    const record = records.get(target) ?? (await files.read<StoredRun | null>(target, null));
    if (!record || record.projectId !== projectId) throw new Error('That run is unavailable in this project.');
    // A terminal receipt must be durable before clients can close or reopen the server.
    if (record.finishedAt) await pending.get(target);
    if (
      record.status === 'running' &&
      !controllers.has(target) &&
      !starting.has(target) &&
      !isProcessAlive(record.ownerPid)
    ) {
      record.status = 'interrupted';
      record.finishedAt = new Date().toISOString();
      record.error = 'The local server stopped before this run finished. Start a new run when ready.';
      await files.write(target, record);
    }
    return structuredClone(record);
  }
  async function perform(record: StoredRun, world: RunWorld, controller: AbortController): Promise<RunRecord> {
    const target = key(record.projectId, record.runId);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]);
    const observed = observeModelReply(world.provider);
    const tools = world.toolSets?.get(JSON.stringify(record.tools ?? [])) ?? [];
    const mcpSession = mcp.session();
    const toolCalls: ToolCallTrace[] = [];
    let toolLimitExceeded = false;
    if (tools.length) record.toolCalls = toolCalls;
    const dispatchTool = async (name: string, input: Record<string, unknown>) => {
      signal.throwIfAborted();
      if (toolCalls.length >= 12) {
        toolLimitExceeded = true;
        throw new Error('The 12-tool-call limit was reached.');
      }
      const binding = tools.find((tool) => tool.name === name);
      const oversized = Buffer.byteLength(JSON.stringify(input)) > 32000;
      const trace: ToolCallTrace = {
        id: crypto.randomUUID(),
        name,
        serverId: binding?.serverId ?? '',
        toolName: binding?.toolName ?? name,
        mode: oversized ? 'refused' : (binding?.mode ?? 'refused'),
        input: oversized ? {} : input,
        ...(binding ? { serverName: binding.server.name } : {}),
        startedAt: new Date().toISOString(),
      };
      toolCalls.push(trace);
      try {
        await files.write(target, record);
        if (!binding) throw new Error('This tool was not selected for the run.');
        if (oversized) throw new Error('Tool arguments exceed 32 KiB.');
        const result = await mcpSession.call(binding, input, signal);
        trace.result = result;
        if (!Array.isArray(result) && typeof result.error === 'string') trace.error = result.error;
        return result;
      } catch (error) {
        trace.error = error instanceof Error ? error.message : 'Tool execution failed.';
        throw error;
      } finally {
        trace.finishedAt = new Date().toISOString();
        await files.write(target, record);
      }
    };
    try {
      signal.throwIfAborted();
      const stopped = new Promise<never>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
      const common = {
        agentName: 'prompt-studio',
        runId: record.runId,
        provider: observed.provider,
        systemPrompt: record.systemPrompt,
        userMessage: record.userMessage || 'Follow the prompt instructions.',
        request: { model: record.model, maxTokens: 8192 },
        signal,
      };
      const execute = async () => {
        if (!tools.length) return runOneShot(common);
        const result = await runAgent({
          ...common,
          tools: tools.map((binding) => ({
            name: binding.name,
            description: binding.tool.description,
            input_schema: binding.tool.inputSchema as unknown as ToolInputSchema,
          })),
          dispatchTool,
          maxIterations: 8,
          tokenBudget: 64000,
        });
        record.usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
        if (result.status !== 'completed' || toolLimitExceeded)
          throw new Error('The tool-enabled run did not complete within its limits.');
        return { text: result.result ?? '' };
      };
      const response = await Promise.race([execute(), stopped]);
      signal.throwIfAborted();
      record.output = response.text;
      if (Buffer.byteLength(record.output) > 128 * 1024) throw new Error('Oversized model output');
      record.status = 'completed';
    } catch (error) {
      if (error instanceof OneShotTruncatedError) record.output = error.partialText;
      record.status = controller.signal.aborted ? 'cancelled' : 'failed';
      record.error = controller.signal.aborted
        ? 'Run cancelled.'
        : signal.aborted
          ? 'The model request timed out.'
          : 'The model request failed. Check the provider settings and retry.';
    } finally {
      await mcpSession.close();
      const wire = observed.reply();
      if (wire) {
        record.model = wire.model ?? record.model;
        if (!tools.length) record.usage = wire.usage;
        record.stopReason = wire.stopReason;
      }
      record.finishedAt = new Date().toISOString();
      try {
        await files.write(target, record);
      } catch {
        record.status = 'failed';
        record.error =
          'Output remains in this server session but could not be saved. Copy or download it before closing Studio.';
      }
      controllers.delete(target);
      cancelled.delete(target);
      active--;
    }
    return structuredClone(record);
  }
  async function begin(input: RunRequest, supplied?: RunWorld): Promise<RunRecord> {
    input = parseRunRequest(input);
    validId(input.runId);
    const target = key(input.projectId, input.runId);
    const requestHash = requestFingerprint(input);
    const underway = starting.get(target);
    if (underway) {
      if (underway.requestHash !== requestHash) throw new Error('This run ID already belongs to a different request.');
      return underway.operation;
    }
    const operation = (async () => {
      if (!supplied) await assertProject(input.projectId, input.revision);
      const existing = records.get(target) ?? (await files.read<StoredRun | null>(target, null));
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new Error('This run ID already belongs to a different request.');
        return get(input.projectId, input.runId);
      }
      const world = supplied ?? (await freeze(input));
      const record: StoredRun = { ...(await prepare(input, world)), requestHash, ownerPid: process.pid };
      if (active >= 2) throw new Error('Two model requests are already running. Wait or stop one before retrying.');
      if (remaining <= 0) throw new Error('The 100-run allowance is exhausted for this server session.');
      const controller = new AbortController();
      controllers.set(target, controller);
      active++;
      remaining--;
      try {
        await files.write(target, record, true);
      } catch (error) {
        controllers.delete(target);
        active--;
        remaining++;
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          const claimed = await files.read<StoredRun | null>(target, null);
          if (claimed?.requestHash !== requestHash)
            throw new Error('This run ID already belongs to a different request.', { cause: error });
          return get(input.projectId, input.runId);
        }
        throw error;
      }
      records.set(target, record);
      if (cancelled.has(target)) controller.abort();
      pending.set(target, perform(record, world, controller));
      return structuredClone(record);
    })();
    starting.set(target, { requestHash, operation });
    try {
      return await operation;
    } finally {
      starting.delete(target);
    }
  }
  return {
    assertProject,
    freeze,
    prepare,
    settings: () => options.settings.describe(),
    start: (input) => begin(input),
    async execute(input, world) {
      await begin(input, world);
      return (await pending.get(key(input.projectId, input.runId))) ?? get(input.projectId, input.runId);
    },
    get,
    async list(projectId, promptPath) {
      await assertProject(projectId);
      const names = await files.list(`${files.project(projectId)}/runs`);
      const loaded = await Promise.all(names.map((name) => get(projectId, name.slice(0, -5))));
      return loaded
        .filter((record) => record.promptPath === promptPath)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 50);
    },
    async cancel(projectId, runId) {
      validId(runId);
      await assertProject(projectId);
      if (cancelled.size > 500) throw new Error('Too many pending cancellation requests.');
      const target = key(projectId, runId);
      const existing = records.get(target) ?? (await files.read<StoredRun | null>(target, null));
      if (
        existing?.status === 'running' &&
        !controllers.has(target) &&
        !starting.has(target) &&
        isProcessAlive(existing.ownerPid)
      )
        throw new Error('This run belongs to another Studio server. Stop it from the server that started it.');
      cancelled.add(target);
      controllers.get(target)?.abort();
    },
  };
}
