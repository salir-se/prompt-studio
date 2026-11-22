import { useCallback, useEffect, useRef, useState } from 'react';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import type { EvalCase, EvalSuite, Evaluation, PromptCandidate, RunSetup } from './contracts';
import { EVALUATION_STARTED, runError, runPost, runQuery, startEvaluation } from './run-client';
import type { RunScope } from './use-run-session';

export function newEvalCase(): EvalCase {
  return { id: crypto.randomUUID(), name: 'New test', inputs: {}, userMessage: '', checks: {} };
}
export function useEvaluationSession(scope: RunScope) {
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [suite, setSuite] = useState<EvalSuite | null>(null);
  const [savedSuite, setSavedSuite] = useState<EvalSuite | null>(null);
  const [versions, setVersions] = useState<PromptCandidate[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const evaluationStart = useRef<{ key: string; id: string } | null>(null);
  const suiteState = useRef({ suite, savedSuite });
  suiteState.current = { suite, savedSuite };
  const { projectId, promptPath } = scope;
  const dirty = JSON.stringify(suite) !== JSON.stringify(savedSuite);
  const load = useCallback(async () => {
    if (pending.current) return;
    const request = ++generation.current;
    setError(null);
    try {
      const [tests, history, tags] = await Promise.all([
        studioJson<{ suites: EvalSuite[] }>(runQuery('/suites', { projectId, promptPath })),
        studioJson<{ evaluations: Evaluation[] }>(runQuery('/evaluations', { projectId, promptPath })),
        studioJson<{ versions: PromptCandidate[] }>(runQuery('/versions', { projectId, promptPath })),
      ]);
      if (request !== generation.current) return;
      const recentSuite =
        tests.suites.find((suite) => suite.id === history.evaluations[0]?.suite.id) ?? tests.suites[0] ?? null;
      setSuites(tests.suites);
      const current = suiteState.current;
      if (JSON.stringify(current.suite) === JSON.stringify(current.savedSuite)) {
        const next = tests.suites.find((suite) => suite.id === current.suite?.id) ?? recentSuite;
        setSuite(next);
        setSavedSuite(next);
      }
      setEvaluations(history.evaluations);
      if (history.evaluations.some((evaluation) => evaluation.id === evaluationStart.current?.id)) {
        evaluationStart.current = null;
      }
      setSelectedId((current) =>
        history.evaluations.some((evaluation) => evaluation.id === current)
          ? current
          : (history.evaluations[0]?.id ?? null),
      );
      setVersions(tags.versions);
    } catch (cause) {
      if (request === generation.current) setError(runError(cause));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [projectId, promptPath]);
  useEffect(() => {
    void load();
    // The rule flags generation counters; they are not DOM nodes, so reading .current at cleanup is intended.
    const invalidate = () => {
      generation.current++;
    };
    return invalidate;
  }, [load]);
  useEffect(() => {
    const receive = (event: Event) => {
      const { detail: evaluation } = event as CustomEvent<Evaluation>;
      if (evaluation.projectId !== projectId || evaluation.suite.promptPath !== promptPath) return;
      setEvaluations((previous) => [evaluation, ...previous.filter((entry) => entry.id !== evaluation.id)]);
      setSelectedId(evaluation.id);
    };
    window.addEventListener(EVALUATION_STARTED, receive);
    return () => window.removeEventListener(EVALUATION_STARTED, receive);
  }, [projectId, promptPath]);
  const runningIds = evaluations
    .filter(
      (evaluation) => evaluation.status === 'running' || (evaluation.status === 'cancelled' && !evaluation.finishedAt),
    )
    .map((entry) => entry.id)
    .join(',');
  useEffect(() => {
    if (!runningIds) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await Promise.all(
          runningIds.split(',').map(async (id) => {
            const result = await studioJson<{ evaluation: Evaluation }>(
              runQuery(`/evaluations/${encodeURIComponent(id)}`, { projectId }),
            );
            return result.evaluation;
          }),
        );
        if (disposed) return;
        setEvaluations((previous) => previous.map((entry) => next.find((updated) => updated.id === entry.id) ?? entry));
        setPollError(null);
      } catch (cause) {
        if (!disposed) setPollError(`Live updates paused: ${runError(cause)}. Retrying automatically.`);
      }
      if (!disposed) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 700);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [runningIds, projectId]);
  async function perform(action: () => Promise<void>): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      if (request === generation.current) setError(runError(cause));
    } finally {
      pending.current = false;
      if (request === generation.current) setBusy(false);
    }
  }
  function chooseSuite(id: string): void {
    if (dirty) {
      setError('Save or discard the current suite edits before switching suites.');
      return;
    }
    const next = suites.find((entry) => entry.id === id) ?? null;
    setSuite(next);
    setSavedSuite(next);
  }
  function createSuite(): void {
    if (dirty) {
      setError('Save or discard the current suite edits before creating another.');
      return;
    }
    setSuite({ id: crypto.randomUUID(), name: 'New test suite', promptPath, cases: [newEvalCase()] });
    setSavedSuite(null);
  }
  async function saveSuite(): Promise<void> {
    if (!suite || scope.projectPending) return;
    await perform(async () => {
      const result = await runPost<{ suite: EvalSuite }>('/suites', {
        projectId,
        revision: scope.revision,
        suite: {
          ...suite,
          cases: suite.cases.map((test) => ({
            ...test,
            checks: {
              ...test.checks,
              ...(test.checks.contains ? { contains: test.checks.contains.filter((value) => value.trim()) } : {}),
              ...(test.checks.notContains
                ? { notContains: test.checks.notContains.filter((value) => value.trim()) }
                : {}),
            },
          })),
        },
      });
      setSuites((previous) => [result.suite, ...previous.filter((entry) => entry.id !== result.suite.id)]);
      setSuite((current) => (current === suite ? result.suite : current));
      setSavedSuite(result.suite);
    });
  }
  async function evaluate(
    candidates: PromptCandidate[],
    setup: RunSetup,
    judge?: { model: string; rubric: string },
  ): Promise<void> {
    if (scope.projectPending || !suite || dirty || busy || runningIds) return;
    await perform(async () => {
      const body = {
        projectId,
        revision: scope.revision,
        suiteId: suite.id,
        candidates,
        provider: setup.provider,
        model: setup.model,
        skills: setup.skills,
        ...(setup.tools ? { tools: setup.tools } : {}),
        ...(judge ? { judge } : {}),
      };
      const key = JSON.stringify({ ...body, suite });
      const id = evaluationStart.current?.key === key ? evaluationStart.current.id : crypto.randomUUID();
      evaluationStart.current = { key, id };
      const evaluation = await startEvaluation({ id, ...body });
      evaluationStart.current = null;
      setEvaluations((previous) => [evaluation, ...previous]);
      setSelectedId(evaluation.id);
    });
  }
  async function cancel(id: string): Promise<void> {
    await perform(async () => {
      await runPost(`/evaluations/${encodeURIComponent(id)}/cancel`, { projectId });
      const result = await studioJson<{ evaluation: Evaluation }>(
        runQuery(`/evaluations/${encodeURIComponent(id)}`, { projectId }),
      );
      setEvaluations((previous) => previous.map((entry) => (entry.id === id ? result.evaluation : entry)));
    });
  }
  async function createTag(name: string): Promise<boolean> {
    if (scope.projectPending) return false;
    let created = false;
    await perform(async () => {
      await studioJson('/__studio/prompt-repo/tags', {
        method: 'POST',
        body: JSON.stringify({ projectId, revision: scope.revision, name }),
      });
      const result = await studioJson<{ versions: PromptCandidate[] }>(
        runQuery('/versions', { projectId, promptPath }),
      );
      setVersions(result.versions);
      created = true;
    });
    return created;
  }
  return {
    suites,
    projectPending: Boolean(scope.projectPending),
    suite,
    setSuite,
    versions,
    evaluations,
    selectedId,
    setSelectedId,
    loading,
    busy,
    error,
    pollError,
    dirty,
    selected: evaluations.find((entry) => entry.id === selectedId) ?? null,
    running: Boolean(runningIds),
    load,
    chooseSuite,
    createSuite,
    saveSuite,
    evaluate,
    cancel,
    createTag,
    discard: () => {
      setSuite(savedSuite);
      setError(null);
    },
  };
}
export type EvaluationSession = ReturnType<typeof useEvaluationSession>;
