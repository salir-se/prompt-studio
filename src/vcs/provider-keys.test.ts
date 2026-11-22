// @vitest-environment node
// @module-tag pure
import { describe, expect, it } from 'vitest';
import { providerKeyFor } from './provider-keys';
import { SimpleHistoryProvider } from './simple-history-provider';
import { MemorySnapshotStore } from './snapshot-store';

/**
 * Variant-qualified provider keys (ADR-235): the composite keying that gives resolver-variant
 * documents (Critic V1/V2/Neutral) independent histories. Proven at the provider seam — the
 * App-level commit/heads/history plumbing all derives its key from `providerKeyFor`, and both
 * providers satisfy the same contract, so exercising SimpleHistoryProvider with composite keys
 * proves the keying (which is all that changed) rather than re-testing provider internals.
 */

describe('providerKeyFor', () => {
  it('keeps the bare root id for the default (no-variant) document', () => {
    expect(providerKeyFor('scout')).toBe('scout');
    expect(providerKeyFor('scout', undefined)).toBe('scout');
  });

  it('qualifies a picked variant as rootId@variantSymbol', () => {
    expect(providerKeyFor('critic-outbound-agent-loop', 'CRITIC_PROMPT')).toBe(
      'critic-outbound-agent-loop@CRITIC_PROMPT',
    );
    expect(providerKeyFor('critic-outbound-agent-loop', 'CRITIC_PROMPT_V2')).toBe(
      'critic-outbound-agent-loop@CRITIC_PROMPT_V2',
    );
  });

  it('never collides across variants or with a bare id', () => {
    const keys = new Set(
      ['critic-outbound-agent-loop', 'CRITIC_PROMPT', 'CRITIC_PROMPT_V2', 'CRITIC_PROMPT_NEUTRAL'].map((id, index) =>
        index === 0 ? providerKeyFor(id) : providerKeyFor('critic-outbound-agent-loop', id),
      ),
    );
    expect(keys.size).toBe(4);
  });
});

describe('SimpleHistoryProvider with variant-qualified keys', () => {
  it('seeds, commits, and reads back independent histories per variant key', async () => {
    const provider = new SimpleHistoryProvider({ snapshotStore: new MemorySnapshotStore() });
    const v1 = providerKeyFor('critic-outbound-agent-loop', 'CRITIC_PROMPT');
    const v2 = providerKeyFor('critic-outbound-agent-loop', 'CRITIC_PROMPT_V2');
    await provider.init(
      new Map([
        [v1, 'critic v1 baseline'],
        [v2, 'critic v2 baseline'],
      ]),
    );
    // The App creates the Default project after init when none exists — mirror that here.
    await provider.createProject('Default');
    const projectId = (await provider.listProjects())[0].id;

    await provider.commit({ projectId, rootKey: v1, text: 'critic v1 edited', message: 'edit critic v1' });

    const heads = await provider.heads(projectId);
    expect(heads.get(v1)).toBe('critic v1 edited');
    expect(heads.get(v2)).toBe('critic v2 baseline'); // untouched by the v1 edit

    const v1History = await provider.history(projectId, v1);
    const v2History = await provider.history(projectId, v2);
    expect(v1History.map((commit) => commit.message)).toEqual(['edit critic v1', 'baseline']);
    expect(v2History.map((commit) => commit.message)).toEqual(['baseline']);
  });
});
