import type { EvalSuite, Evaluation, PromptCandidate, RunRecord, RunSettings, RunSetup } from './contracts';

export const RUN_SETTINGS: RunSettings = {
  skillsFolder: '/home/you/skills',
  provider: 'openai',
  model: 'configured-model',
  baseUrl: '',
  connected: true,
  skills: [
    {
      id: 'research',
      name: 'Research with evidence',
      path: 'research/SKILL.md',
      description: 'Find reliable evidence and cite project sources.',
    },
    {
      id: 'writing',
      name: 'Clear writing',
      path: 'writing/SKILL.md',
      description: 'Make every sentence easy to understand.',
    },
  ],
};
export const RUN_SETUP: RunSetup = {
  provider: 'openai',
  model: 'configured-model',
  inputs: { subject: 'Battery recycling' },
  userMessage: 'Give me three practical recommendations.',
  skills: ['research'],
};
export const RUN_SOURCE = '# Research brief\nResearch {{subject}} using @references/evidence.md. Cite your sources.';
export const CAPTURED_RUN: RunRecord = {
  ...RUN_SETUP,
  runId: 'run-example',
  projectId: 'project-example',
  revision: 3,
  promptPath: 'prompts/research.md',
  source: RUN_SOURCE,
  skills: [
    {
      id: 'research',
      name: 'Research with evidence',
      files: [{ path: 'research/SKILL.md', text: 'Use evidence.', hash: 'skill-hash' }],
    },
  ],
  files: [{ path: 'references/evidence.md', text: 'Use certified recycling facilities.', hash: 'file-hash' }],
  systemPrompt: 'Research Battery recycling using the attached evidence.\nUse certified recycling facilities.',
  sourceHash: 'saved-source-fingerprint',
  startedAt: '2026-10-21T12:30:00Z',
  finishedAt: '2026-10-21T12:30:03Z',
  status: 'completed',
  output:
    '1. Choose certified recycling facilities.\n2. Track material recovery rates.\n3. Keep a clear chain of custody.\n\nSource: references/evidence.md',
  usage: { inputTokens: 240, outputTokens: 64 },
};
export const TEST_SUITE: EvalSuite = {
  id: 'suite-example',
  name: 'Research quality',
  promptPath: CAPTURED_RUN.promptPath,
  cases: [
    {
      id: 'case-example',
      name: 'Evidence in recommendations',
      inputs: RUN_SETUP.inputs,
      userMessage: RUN_SETUP.userMessage,
      expected: 'Actionable recommendations with cited project evidence.',
      checks: { contains: ['Source:'] },
    },
  ],
};
export const TAG_CANDIDATE: PromptCandidate = {
  id: 'tag:prompt-v1',
  label: 'prompt-v1',
  source: 'Research {{subject}}.',
  commit: '0123456789abcdef0123456789abcdef01234567',
};
export const CAPTURED_EVALUATION: Evaluation = {
  id: 'evaluation-example',
  projectId: 'project-example',
  suite: TEST_SUITE,
  candidates: [TAG_CANDIDATE, { id: 'working', label: 'Current draft', source: RUN_SOURCE }],
  setup: { provider: 'openai', model: RUN_SETUP.model, skills: ['research'] },
  startedAt: CAPTURED_RUN.startedAt,
  finishedAt: CAPTURED_RUN.finishedAt,
  status: 'completed',
  results: [
    {
      caseId: 'case-example',
      candidateId: TAG_CANDIDATE.id,
      runId: 'baseline-run',
      status: 'failed',
      checks: [{ label: 'Contains “Source:”', passed: false }],
      output: 'Recycle batteries responsibly.',
    },
    {
      caseId: 'case-example',
      candidateId: 'working',
      runId: 'candidate-run',
      status: 'passed',
      checks: [{ label: 'Contains “Source:”', passed: true }],
      output: CAPTURED_RUN.output,
    },
  ],
  judge: {
    model: 'judge-model',
    rubric: 'Prefer recommendations grounded in the provided project evidence.',
    results: [
      {
        caseId: 'case-example',
        verdict: 'B',
        reason: 'B gives specific recommendations and cites the project evidence.',
        model: 'judge-model',
      },
    ],
  },
};
