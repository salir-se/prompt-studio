// @module-tag pure
import { describe, expect, it } from 'vitest';
import {
  AXIOM_API_BASE_URL,
  AXIOM_INGEST_BASE_URL,
  axiomDatasetForEnvironment,
  axiomTracesDatasetForEnvironment,
} from './dataset';

describe('axiomDatasetForEnvironment', () => {
  it('maps production to the production dataset', () => {
    expect(axiomDatasetForEnvironment('production')).toBe('salir-logs-production');
  });

  it('maps staging to the staging dataset', () => {
    expect(axiomDatasetForEnvironment('staging')).toBe('salir-logs-staging');
  });

  it('maps preview to the staging dataset', () => {
    expect(axiomDatasetForEnvironment('preview')).toBe('salir-logs-staging');
  });

  it.each(['local', 'dev', 'test', 'canary', ''])('maps %j to the staging dataset', (environment) => {
    expect(axiomDatasetForEnvironment(environment)).toBe('salir-logs-staging');
  });

  it('maps undefined to the staging dataset', () => {
    expect(axiomDatasetForEnvironment(undefined)).toBe('salir-logs-staging');
  });

  it('lets a non-empty override win over any environment mapping', () => {
    expect(axiomDatasetForEnvironment('production', 'custom-dataset')).toBe('custom-dataset');
    expect(axiomDatasetForEnvironment(undefined, 'custom-dataset')).toBe('custom-dataset');
  });

  it('trims the override before using it', () => {
    expect(axiomDatasetForEnvironment('production', '  custom-dataset  ')).toBe('custom-dataset');
  });

  it('falls back to the environment mapping when the override is whitespace-only', () => {
    expect(axiomDatasetForEnvironment('production', '   ')).toBe('salir-logs-production');
  });

  it('falls back to the environment mapping when the override is omitted', () => {
    expect(axiomDatasetForEnvironment('staging')).toBe('salir-logs-staging');
  });
});

describe('axiomTracesDatasetForEnvironment', () => {
  it('maps production separately and every non-production environment to staging', () => {
    expect(axiomTracesDatasetForEnvironment('production')).toBe('salir-traces-production');
    expect(axiomTracesDatasetForEnvironment('staging')).toBe('salir-traces-staging');
    expect(axiomTracesDatasetForEnvironment('preview')).toBe('salir-traces-staging');
    expect(axiomTracesDatasetForEnvironment(undefined)).toBe('salir-traces-staging');
  });
});

describe('Axiom hosts (region-pinned datasets)', () => {
  it('ingest defaults to the eu-central-1 edge domain — api.axiom.co answers 400 mismatched region', () => {
    expect(AXIOM_INGEST_BASE_URL).toBe('https://eu-central-1.aws.edge.axiom.co');
  });
  it('management + APL query stay on the global API host', () => {
    expect(AXIOM_API_BASE_URL).toBe('https://api.axiom.co');
    expect(AXIOM_API_BASE_URL).not.toBe(AXIOM_INGEST_BASE_URL);
  });
});
