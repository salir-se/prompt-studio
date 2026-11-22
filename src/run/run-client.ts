export { extractPlaceholderNames as promptVariables } from '@prompt-studio/prompts';

import { studioJson } from '../prompt-repo/prompt-repo-client';
import type { Evaluation, PromptCandidate, RunProvider, RunSettings, RunSetup } from './contracts';

export function runQuery(path: string, values: Record<string, string>): string {
  return `/__studio/run${path}?${new URLSearchParams(values)}`;
}
export async function runPost<T>(path: string, body: unknown, recoveryPath?: string): Promise<T> {
  try {
    return await studioJson<T>(`/__studio/run${path}`, { method: 'POST', body: JSON.stringify(body) });
  } catch (cause) {
    if (recoveryPath) {
      try {
        return await studioJson<T>(recoveryPath);
      } catch {
        // A failed lookup must preserve the original validation or network error.
      }
    }
    throw cause;
  }
}

export async function startEvaluation(
  input: Pick<RunSetup, 'provider' | 'model' | 'skills' | 'tools'> & {
    id: string;
    projectId: string;
    revision: number;
    suiteId: string;
    candidates: PromptCandidate[];
    judge?: { model: string; rubric: string };
  },
): Promise<Evaluation> {
  const { evaluation } = await runPost<{ evaluation: Evaluation }>(
    '/evaluations',
    input,
    runQuery(`/evaluations/${input.id}`, { projectId: input.projectId }),
  );
  return evaluation;
}

export const EVALUATION_STARTED = 'studio:evaluation-started';

export function announceEvaluation(evaluation: Evaluation): void {
  window.dispatchEvent(new CustomEvent<Evaluation>(EVALUATION_STARTED, { detail: evaluation }));
}
export function runError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function downloadRun(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function providerConnected(
  settings: (RunSettings & { connectedProviders?: RunProvider[] }) | null,
  provider: RunProvider,
): boolean {
  return (
    settings?.connectedProviders?.includes(provider) ?? Boolean(settings?.connected && settings.provider === provider)
  );
}
