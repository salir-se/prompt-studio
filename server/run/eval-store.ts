import { createHash } from 'node:crypto';
import type { EvalSuite, Evaluation } from '../../src/run/contracts';
import { LocalRunStore } from './local-store';

export function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export interface StoredEvaluation {
  evaluation: Evaluation;
  fingerprint: string;
  ownerPid?: number;
}
export interface StoredSuite {
  suite: EvalSuite;
  versions: EvalSuite[];
}
export function createEvalStore(directory: string) {
  const files = new LocalRunStore(directory);
  const folder = (projectId: string, kind: 'suites' | 'evaluations') => `${kind}/${digest(projectId)}`;
  const target = (projectId: string, kind: 'suites' | 'evaluations', id: string) =>
    `${folder(projectId, kind)}/${digest(id)}.json`;
  return {
    read<T>(projectId: string, kind: 'suites' | 'evaluations', id: string): Promise<T | undefined> {
      return files.read<T | undefined>(target(projectId, kind, id), undefined);
    },
    write(projectId: string, kind: 'suites' | 'evaluations', id: string, value: unknown, exclusive = false) {
      return files.write(target(projectId, kind, id), value, exclusive);
    },
    async list<T>(projectId: string, kind: 'suites' | 'evaluations'): Promise<T[]> {
      const parent = folder(projectId, kind);
      const entries = (await files.list(parent)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
      return Promise.all(entries.map((name) => files.read<T>(`${parent}/${name}`, undefined as T)));
    },
  };
}
