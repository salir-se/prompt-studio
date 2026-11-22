import { useCallback, useEffect, useRef, useState } from 'react';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import type { RunRecord, RunSettings, RunSetup } from './contracts';
import { providerConnected, runError, runPost, runQuery } from './run-client';
import { announceRunSettings, RUN_SETTINGS_CHANGED } from './run-settings-events';

export interface RunScope {
  projectId: string;
  revision: number;
  promptPath: string;
  source: string;
  projectPending?: boolean;
}
export const EMPTY_SETUP: RunSetup = { provider: 'openai', model: '', inputs: {}, userMessage: '', skills: [] };

export function useRunSession(scope: RunScope) {
  const [settings, setSettings] = useState<RunSettings | null>(null);
  const [setup, setSetup] = useState<RunSetup>(EMPTY_SETUP);
  const [savedSetup, setSavedSetup] = useState<RunSetup>(EMPTY_SETUP);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const generation = useRef(0);
  const settingsUpdate = useRef<RunSettings | null>(null);
  const pending = useRef(false);
  const unconfirmedRun = useRef<{ key: string; id: string } | null>(null);
  const { projectId, promptPath } = scope;
  const load = useCallback(async () => {
    const request = ++generation.current;
    const settingsAtStart = settingsUpdate.current;
    setLoading(true);
    setError(null);
    try {
      const [loadedConfig, profile, history] = await Promise.all([
        studioJson<RunSettings>('/__studio/run/settings'),
        studioJson<{ profile: RunSetup | null }>(runQuery('/profile', { projectId, promptPath })),
        studioJson<{ runs: RunRecord[] }>(runQuery('', { projectId, promptPath })),
      ]);
      if (request !== generation.current) return;
      const config =
        settingsUpdate.current !== settingsAtStart ? (settingsUpdate.current ?? loadedConfig) : loadedConfig;
      const next = { ...(profile.profile ?? EMPTY_SETUP), provider: config.provider, model: config.model };
      setSettings(config);
      setSetup(next);
      setSavedSetup(next);
      setRuns(history.runs);
      setSelectedId(history.runs[0]?.runId ?? null);
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
    const update = (event: Event) => {
      const config = (event as CustomEvent<RunSettings>).detail;
      settingsUpdate.current = config;
      setSettings(config);
      setSetup((previous) => ({ ...previous, provider: config.provider, model: config.model }));
      setSavedSetup((previous) => ({ ...previous, provider: config.provider, model: config.model }));
    };
    window.addEventListener(RUN_SETTINGS_CHANGED, update);
    return () => window.removeEventListener(RUN_SETTINGS_CHANGED, update);
  }, []);

  const runningIds = runs
    .filter((run) => run.status === 'running' || (run.status === 'cancelled' && !run.finishedAt))
    .map((run) => run.runId)
    .join(',');
  useEffect(() => {
    if (!runningIds) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const updated = await Promise.all(
          runningIds.split(',').map(async (id) => {
            const result = await studioJson<{ run: RunRecord }>(runQuery(`/${encodeURIComponent(id)}`, { projectId }));
            return result.run;
          }),
        );
        if (disposed) return;
        setRuns((previous) => previous.map((run) => updated.find((next) => next.runId === run.runId) ?? run));
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

  async function saveProfile(): Promise<void> {
    if (scope.projectPending) throw new Error('Wait for project changes to save before saving run setup.');
    await runPost('/profile', { projectId, revision: scope.revision, promptPath, profile: setup });
    setSavedSetup(setup);
  }
  async function perform(action: () => Promise<void>): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true;
    const request = generation.current;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (cause) {
      if (request === generation.current) setError(runError(cause));
      return false;
    } finally {
      pending.current = false;
      if (request === generation.current) setBusy(false);
    }
  }
  const connected = providerConnected(settings, setup.provider);
  async function run(): Promise<void> {
    if (scope.projectPending || busy || runningIds || !connected || !setup.model.trim()) return;
    await perform(async () => {
      await saveProfile();
      const input = {
        projectId,
        revision: scope.revision,
        promptPath,
        source: scope.source,
        provider: setup.provider,
        model: setup.model,
        inputs: setup.inputs,
        userMessage: setup.userMessage,
        skills: setup.skills,
        ...(setup.tools ? { tools: setup.tools } : {}),
      };
      const key = JSON.stringify(input);
      const runId = unconfirmedRun.current?.key === key ? unconfirmedRun.current.id : crypto.randomUUID();
      unconfirmedRun.current = { key, id: runId };
      const result = await runPost<{ run: RunRecord }>(
        '',
        { ...input, runId },
        runQuery(`/${encodeURIComponent(runId)}`, { projectId }),
      );
      unconfirmedRun.current = null;
      setRuns((previous) => [result.run, ...previous]);
      setSelectedId(result.run.runId);
    });
  }
  async function cancel(runId: string): Promise<void> {
    await perform(async () => {
      await runPost(`/${encodeURIComponent(runId)}/cancel`, { projectId });
      const result = await studioJson<{ run: RunRecord }>(runQuery(`/${encodeURIComponent(runId)}`, { projectId }));
      setRuns((previous) => previous.map((run) => (run.runId === runId ? result.run : run)));
    });
  }
  async function saveSettings(next: Omit<RunSettings, 'skills' | 'connected'> & { apiKey?: string }): Promise<boolean> {
    let saved = false;
    await perform(async () => {
      const result = await runPost<RunSettings>('/settings', next);
      announceRunSettings(result);
      saved = true;
    });
    return saved;
  }
  return {
    settings,
    connected,
    projectPending: Boolean(scope.projectPending),
    setup,
    setSetup,
    runs,
    selectedId,
    setSelectedId,
    loading,
    busy,
    error,
    pollError,
    selected: runs.find((run) => run.runId === selectedId) ?? null,
    dirty: JSON.stringify(setup) !== JSON.stringify(savedSetup),
    running: Boolean(runningIds),
    load,
    run,
    cancel,
    saveSettings,
    saveProfile: () => perform(saveProfile),
  };
}
export type RunSession = ReturnType<typeof useRunSession>;
