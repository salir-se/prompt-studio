import type { CapturedToolDefinition, StudioMcpServer, ToolBinding, ToolCallTrace } from '../mcp/contracts';
export const RUN_PROVIDERS = ['zai', 'openai', 'anthropic', 'openrouter', 'openai-compat'] as const;
export type RunProvider = (typeof RUN_PROVIDERS)[number];
export interface RunSetup {
  provider: RunProvider;
  model: string;
  inputs: Record<string, string>;
  userMessage: string;
  skills: string[];
  tools?: ToolBinding[];
}
export interface SkillEntry {
  id: string;
  name: string;
  path: string;
  description: string;
}
export interface HelpModel {
  provider: RunProvider;
  model: string;
}
export interface RunSettings {
  helpModel?: HelpModel | null;
  skillsFolder: string;
  provider: RunProvider;
  model: string;
  baseUrl: string;
  connected: boolean;
  connectedProviders?: RunProvider[];
  skills: SkillEntry[];
  skillsError?: string;
  mcpServers?: StudioMcpServer[];
}
export interface RunRequest extends RunSetup {
  runId: string;
  projectId: string;
  revision: number;
  promptPath: string;
  source: string;
}
export interface CapturedFile {
  path: string;
  text: string;
  hash: string;
}
export interface RunRecord extends Omit<RunRequest, 'skills'> {
  skills: { id: string; name: string; files: CapturedFile[] }[];
  files: CapturedFile[];
  systemPrompt: string;
  sourceHash: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  output: string;
  error?: string;
  toolCalls?: ToolCallTrace[];
  toolDefinitions?: CapturedToolDefinition[];
  stopReason?: string;
  usage?: { inputTokens: number; outputTokens: number };
}
export interface EvalCase {
  tools?: ToolBinding[];
  id: string;
  name: string;
  inputs: Record<string, string>;
  userMessage: string;
  expected?: string;
  checks: { contains?: string[]; notContains?: string[]; equals?: string; json?: boolean };
}
export interface EvalSuite {
  id: string;
  name: string;
  promptPath: string;
  cases: EvalCase[];
}
export interface PromptCandidate {
  id: string;
  label: string;
  source: string;
  commit?: string;
}
export interface EvalCaseResult {
  toolCalls?: ToolCallTrace[];
  toolDefinitions?: CapturedToolDefinition[];
  caseId: string;
  candidateId: string;
  runId: string;
  status: 'passed' | 'failed' | 'unscored' | 'error';
  checks: { label: string; passed: boolean }[];
  output: string;
  error?: string;
}
export interface JudgeResult {
  caseId: string;
  verdict: 'A' | 'B' | 'tie' | 'error';
  reason: string;
  model: string;
  runId?: string;
  output?: string;
}
export interface Evaluation {
  id: string;
  projectId: string;
  suite: EvalSuite;
  candidates: PromptCandidate[];
  setup: Pick<RunSetup, 'provider' | 'model' | 'skills' | 'tools'>;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
  results: EvalCaseResult[];
  judge?: { model: string; rubric: string; results: JudgeResult[] };
  error?: string;
}
