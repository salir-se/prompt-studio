// @vitest-environment node
// @module-tag pure
import { beforeEach, describe, expect, it } from 'vitest';
import type { BaselineContent } from '../catalog/baseline-content-source';
import { SimpleHistoryProvider } from '../vcs/simple-history-provider';
import { MemorySnapshotStore } from '../vcs/snapshot-store';
import { applyTemplate, resetConfigurationToStart, shippedTemplate, templateFromBaseline } from './apply-template';
import { documentKeysForBaseline, SALES_MODE_SLOT_TO_DOCUMENT } from './slot-mapping';

/**
 * Configuration seed/reset semantics (ADR-235), proven at the pure-function + provider seam the
 * App composes: slot→document mapping, commit-per-document seeds with provenance messages, the
 * no-op shipped default, the shipped-foundation-plus-seed reset, and config-origin persistence.
 */

const baseline: BaselineContent = {
  id: 'test-mode',
  version: 2,
  generationLabel: 'gold/test/v2',
  prompts: {
    icp: 'test icp text',
    persona: 'test persona text',
    scout: 'test scout text',
    researcher: '',
    criticInbound: 'test critic inbound',
    closer: 'test closer',
    critic: 'test critic',
    discoveryProtocol: 'test discovery',
  },
};

describe('slot mapping', () => {
  it('maps every sales-mode slot to a studio document key', () => {
    expect(Object.keys(SALES_MODE_SLOT_TO_DOCUMENT).sort()).toEqual([
      'closer',
      'critic',
      'criticInbound',
      'discoveryProtocol',
      'icp',
      'persona',
      'researcher',
      'scout',
    ]);
  });

  it('qualifies the critic slot with the default variant key', () => {
    expect(SALES_MODE_SLOT_TO_DOCUMENT.critic).toBe('critic-outbound-agent-loop@CRITIC_PROMPT');
  });

  it('drops empty slot texts — absent documents inherit the shipped default', () => {
    const documents = documentKeysForBaseline(baseline);
    expect(documents.get('scout')).toBe('test scout text');
    expect(documents.has('researcher')).toBe(false);
    expect(documents.size).toBe(7);
  });
});

describe('applyTemplate', () => {
  let provider: SimpleHistoryProvider;
  let projectId: string;

  beforeEach(async () => {
    provider = new SimpleHistoryProvider({ snapshotStore: new MemorySnapshotStore() });
    await provider.init(
      new Map([
        ['scout', 'shipped scout'],
        ['icp', 'shipped icp'],
        ['closer', 'shipped closer'],
      ]),
    );
    const created = await provider.createProject('Trial');
    projectId = created.id;
  });

  it('commits one seed per template document, with provenance in the message', async () => {
    const applied = await applyTemplate(provider, projectId, templateFromBaseline(baseline));
    expect(applied).toBe(7);
    const history = await provider.history(projectId, 'scout');
    expect(history[0]?.message).toBe('seed from reference test-mode (scout)');
    const heads = await provider.heads(projectId);
    expect(heads.get('scout')).toBe('test scout text');
    expect(heads.get('closer')).toBe('test closer');
  });

  it('commits nothing for the shipped-default template', async () => {
    const applied = await applyTemplate(provider, projectId, shippedTemplate());
    expect(applied).toBe(0);
    const heads = await provider.heads(projectId);
    expect(heads.get('scout')).toBe('shipped scout');
  });

  it('reset rebuilds the shipped foundation then the seed, all append-only', async () => {
    // Diverge first.
    await provider.commit({ projectId, rootKey: 'scout', text: 'diverged', message: 'edit scout' });
    // A shipped-foundation map covering the interesting keys.
    const shippedTexts = new Map([
      ['scout', 'shipped scout'],
      ['icp', 'shipped icp'],
      ['closer', 'shipped closer'],
    ]);
    const applied = await resetConfigurationToStart(provider, projectId, templateFromBaseline(baseline), shippedTexts);
    expect(applied).toBe(3 + 7);

    const heads = await provider.heads(projectId);
    expect(heads.get('scout')).toBe('test scout text'); // shipped, then seed on top
    expect(heads.get('icp')).toBe('test icp text');

    const history = await provider.history(projectId, 'scout');
    expect(history.map((commit) => commit.message)).toEqual([
      'reset from reference test-mode (scout)',
      'reset to shipped default (scout)',
      'edit scout',
      'baseline',
    ]);
  });
});
