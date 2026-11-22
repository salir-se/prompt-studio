import { ControlCommandError } from '@prompt-studio/control-protocol';
import { type } from 'arktype';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import type { EvalSuite, Evaluation, PromptCandidate, RunSettings, RunSetup } from '../run/contracts';
import { announceEvaluation, providerConnected, runQuery, startEvaluation } from '../run/run-client';
import type { RunScope } from '../run/use-run-session';
import type { ControlHandler } from './control-channel';

export interface EvaluationCommandScope extends RunScope {
  readonly rootId: string;
  readonly draft: boolean;
}

const document = { rootId: 'string > 0', 'variantSymbol?': 'string > 0', '+': 'reject' } as const;
const evaluationId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const run = { ...document, suiteId: 'string > 0', allowPaidRun: 'true' } as const;
const documentArgs = type(document);
const runArgs = type(run);
const compareArgs = type({ ...run, baselineTag: 'string > 0', 'candidateTag?': 'string > 0' });
const resultArgs = type({ ...document, evaluationId });

function validated<T>(schema: (raw: unknown) => T | type.errors, raw: unknown): T {
  const input = schema(raw);
  if (input instanceof type.errors) throw new ControlCommandError('invalid_input', input.summary);
  return input;
}

export function buildEvaluationCommands(scope?: EvaluationCommandScope): Record<string, ControlHandler> {
  function current(rootId: string, variantSymbol?: string) {
    if (!scope || scope.rootId !== rootId || variantSymbol !== undefined) {
      throw new ControlCommandError('missing_target', `Open the project prompt "${rootId}" before using evaluations.`);
    }
    return scope;
  }

  async function suites(scope: EvaluationCommandScope) {
    const { suites } = await studioJson<{ suites: EvalSuite[] }>(runQuery('/suites', scopeQuery(scope)));
    return suites;
  }

  async function start(input: typeof runArgs.infer, baselineTag?: string, candidateTag?: string) {
    const scope = current(input.rootId, input.variantSymbol);
    if (scope.projectPending) throw new ControlCommandError('not_ready', 'Wait for the project changes to save.');
    const query = scopeQuery(scope);
    const [available, settings, profile] = await Promise.all([
      suites(scope),
      studioJson<RunSettings>('/__studio/run/settings'),
      studioJson<{ profile: RunSetup | null }>(runQuery('/profile', query)),
    ]);
    if (!available.some((suite) => suite.id === input.suiteId)) {
      throw new ControlCommandError('missing_target', 'Choose a saved suite for the open prompt with list_suites.');
    }
    if (!settings.model.trim() || !providerConnected(settings, settings.provider)) {
      throw new ControlCommandError('not_ready', 'Connect a provider and select a model in Run Settings.');
    }

    const working: PromptCandidate = {
      id: 'working',
      label: scope.draft ? 'Current draft' : 'Current prompt',
      source: scope.source,
    };
    let candidates = [working];
    if (baselineTag !== undefined) {
      const { versions } = await studioJson<{ versions: PromptCandidate[] }>(runQuery('/versions', query));
      const baseline = versions.find((version) => version.id === `tag:${baselineTag}`);
      const candidate =
        candidateTag === undefined ? working : versions.find((version) => version.id === `tag:${candidateTag}`);
      if (!baseline || !candidate) {
        throw new ControlCommandError('missing_target', 'Choose Git tags that contain the open prompt.');
      }
      if (baseline.id === candidate.id)
        throw new ControlCommandError('invalid_input', 'Choose two different prompt versions.');
      candidates = [baseline, candidate];
    }

    const { provider, model } = settings;
    const { skills = [], tools } = profile.profile ?? {};
    const evaluation = await startEvaluation({
      id: crypto.randomUUID(),
      projectId: scope.projectId,
      revision: scope.revision,
      suiteId: input.suiteId,
      candidates,
      provider,
      model,
      skills,
      ...(tools ? { tools } : {}),
    });
    announceEvaluation(evaluation);
    return { id: evaluation.id, status: evaluation.status };
  }

  return {
    async listSuites(raw) {
      const input = validated(documentArgs, raw);
      return (await suites(current(input.rootId, input.variantSymbol))).map(({ id, name, cases }) => ({
        id,
        name,
        cases: cases.map(({ id, name }) => ({ id, name })),
      }));
    },
    runSuite: (raw) => start(validated(runArgs, raw)),
    compareVersions(raw) {
      const input = validated(compareArgs, raw);
      return start(input, input.baselineTag, input.candidateTag);
    },
    async getEvaluationResults(raw) {
      const input = validated(resultArgs, raw);
      const scope = current(input.rootId, input.variantSymbol);
      const { evaluation } = await studioJson<{ evaluation: Evaluation }>(
        runQuery(`/evaluations/${input.evaluationId}`, scopeQuery(scope)),
      );
      if (evaluation.suite.promptPath !== scope.promptPath) {
        throw new ControlCommandError('missing_target', 'That evaluation belongs to a different prompt.');
      }
      const { id, status, finishedAt, suite, candidates, results } = evaluation;
      return {
        id,
        status,
        finishedAt,
        suite: { id: suite.id, name: suite.name, cases: suite.cases.map(({ id, name }) => ({ id, name })) },
        candidates: candidates.map(({ id, label, commit }) => ({ id, label, commit })),
        results: results.map(({ caseId, candidateId, status, checks }) => ({ caseId, candidateId, status, checks })),
      };
    },
  };
}

function scopeQuery({ projectId, promptPath }: EvaluationCommandScope) {
  return { projectId, promptPath };
}
