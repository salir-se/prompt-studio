/**
 * Reusable contract-test suite for `HistoryProvider` (ADR-203): the SAME suite runs against
 * `SimpleHistoryProvider` (the reference implementation) and the git provider, so the two can never
 * drift apart on observable behavior. Every assertion goes through the interface only — no reaching
 * into implementation state — which is exactly what makes the suite reusable verbatim.
 *
 * `makeProvider` requirements (the caller's responsibility):
 *  - each call returns a FRESH provider instance (no in-memory state carried over);
 *  - all instances share ONE snapshot store that starts EMPTY — the persistence tests create a
 *    second instance and restore into it, and the empty-store test runs before anything persists;
 *  - the provider must not write the snapshot store outside `persist()` (per the interface doc),
 *    otherwise the empty-store expectation breaks.
 *
 * No test is registered at module load — the exported function registers the `describe` block, so
 * importing this file from a non-test module is harmless.
 */

import { describe, expect, it } from 'vitest';
import type { HistoryProvider } from './history-provider';

/** Two roots is the minimum that proves per-root scoping (history filters, untouched-root heads). */
const BASELINE_TEXTS: ReadonlyMap<string, string> = new Map([
  ['scout', 'Scout baseline text.'],
  ['closer', 'Closer baseline text.'],
]);

/** Registers the full `HistoryProvider` contract as one `describe` block labeled for the implementation. */
export function runHistoryProviderContractTests(label: string, makeProvider: () => Promise<HistoryProvider>): void {
  /** A fresh provider with the baseline already seeded — the starting point of almost every test. */
  async function seededProvider(): Promise<HistoryProvider> {
    const provider = await makeProvider();
    await provider.init(BASELINE_TEXTS);
    return provider;
  }

  describe(`HistoryProvider contract: ${label}`, { shuffle: false }, () => {
    it('init seeds a baseline readable through heads and history, and is idempotent', async () => {
      const provider = await seededProvider();

      expect(await provider.heads('baseline')).toEqual(BASELINE_TEXTS);

      const log = await provider.history('baseline');
      expect(log).toHaveLength(BASELINE_TEXTS.size);
      expect(log.every((commit) => commit.message === 'baseline')).toBe(true);
      expect(new Set(log.map((commit) => commit.rootKey))).toEqual(new Set(BASELINE_TEXTS.keys()));

      await provider.init(BASELINE_TEXTS); // Second init in the same boot must not duplicate seeds.
      expect(await provider.history('baseline')).toHaveLength(BASELINE_TEXTS.size);
    });

    it('createProject forks from baseline with heads equal to the baseline', async () => {
      const provider = await seededProvider();
      const project = await provider.createProject('My Project');

      expect(project.name).toBe('My Project');
      expect(await provider.heads(project.id)).toEqual(await provider.heads('baseline'));

      const listed = await provider.listProjects();
      expect(listed.map((ref) => ref.id)).toContain(project.id);
      expect(listed.map((ref) => ref.id)).not.toContain('baseline'); // Pseudo-project stays unlisted.
    });

    it('rejects an empty project name', async () => {
      const provider = await seededProvider();
      await expect(provider.createProject('   ')).rejects.toThrow();
    });

    it('commit updates heads and prepends history, down to the baseline seed', async () => {
      const provider = await seededProvider();
      const project = await provider.createProject('Edits');
      const ref = await provider.commit({
        projectId: project.id,
        rootKey: 'scout',
        text: 'Scout v1.',
        message: 'edit scout',
      });

      expect(ref.rootKey).toBe('scout');
      expect(ref.message).toBe('edit scout');

      const heads = await provider.heads(project.id);
      expect(heads.get('scout')).toBe('Scout v1.');
      expect(heads.get('closer')).toBe(BASELINE_TEXTS.get('closer')); // Untouched root keeps baseline.

      const all = await provider.history(project.id);
      expect(all[0].id).toBe(ref.id); // Newest-first across all roots.

      const scoutOnly = await provider.history(project.id, 'scout');
      expect(scoutOnly[0].id).toBe(ref.id);
      expect(scoutOnly.every((commit) => commit.rootKey === 'scout')).toBe(true);
      expect(scoutOnly.at(-1)?.message).toBe('baseline'); // The chain bottoms out in the seed.
    });

    it('readTextAt returns each exact prior text across a three-commit chain', async () => {
      const provider = await seededProvider();
      const project = await provider.createProject('Chain');
      const texts = ['Scout v1.', 'Scout v2.', 'Scout v3.'];
      const refs = [];
      for (const [index, text] of texts.entries()) {
        refs.push(
          await provider.commit({ projectId: project.id, rootKey: 'scout', text, message: `edit ${index + 1}` }),
        );
      }

      for (const [index, ref] of refs.entries()) {
        expect(await provider.readTextAt(project.id, ref.id, 'scout')).toBe(texts[index]);
      }
      // A commit that only touched 'scout' has nothing to say about 'closer'.
      expect(await provider.readTextAt(project.id, refs[0].id, 'closer')).toBeNull();
    });

    it('forking from a project inherits its heads but not its later commits', async () => {
      const provider = await seededProvider();
      const source = await provider.createProject('Source');
      const before = await provider.commit({
        projectId: source.id,
        rootKey: 'scout',
        text: 'Scout v1.',
        message: 'before fork',
      });

      const fork = await provider.createProject('Fork', source.id);
      expect((await provider.heads(fork.id)).get('scout')).toBe('Scout v1.');

      const after = await provider.commit({
        projectId: source.id,
        rootKey: 'scout',
        text: 'Scout v2.',
        message: 'after fork',
      });

      expect((await provider.heads(fork.id)).get('scout')).toBe('Scout v1.'); // Still the fork point.
      const forkIds = (await provider.history(fork.id, 'scout')).map((commit) => commit.id);
      expect(forkIds).toContain(before.id);
      expect(forkIds).not.toContain(after.id);
      expect((await provider.history(source.id, 'scout'))[0].id).toBe(after.id);
    });

    it('renameProject changes the listed name; deleteProject removes the project', async () => {
      const provider = await seededProvider();
      const project = await provider.createProject('Alpha');

      await provider.renameProject(project.id, 'Alpha Two');
      const renamed = (await provider.listProjects()).find((ref) => ref.id === project.id);
      expect(renamed?.name).toBe('Alpha Two');
      await expect(provider.renameProject(project.id, '  ')).rejects.toThrow();

      await provider.deleteProject(project.id);
      expect((await provider.listProjects()).map((ref) => ref.id)).not.toContain(project.id);
    });

    it('rejects every mutation of the baseline pseudo-project', async () => {
      const provider = await seededProvider();
      await expect(provider.createProject('Baseline')).rejects.toThrow();
      await expect(provider.renameProject('baseline', 'shipped')).rejects.toThrow();
      await expect(provider.deleteProject('baseline')).rejects.toThrow();
      await expect(
        provider.commit({ projectId: 'baseline', rootKey: 'scout', text: 'nope', message: 'nope' }),
      ).rejects.toThrow();
    });

    // The two persistence tests are order-sensitive by design: the empty-store test MUST run before
    // anything persists into the shared store (see the makeProvider requirements in the module doc).
    it('restore on an empty snapshot store returns false', async () => {
      const provider = await makeProvider();
      expect(await provider.restore()).toBe(false);
    });

    it('persist then restore into a new instance reproduces projects, heads, and history', async () => {
      const original = await seededProvider();
      const project = await original.createProject('Persisted');
      await original.commit({ projectId: project.id, rootKey: 'scout', text: 'Scout v1.', message: 'edit scout' });
      await original.persist();

      const restored = await makeProvider();
      expect(await restored.restore()).toBe(true);
      expect(await restored.listProjects()).toEqual(await original.listProjects());
      expect(await restored.heads(project.id)).toEqual(await original.heads(project.id));
      expect(await restored.history(project.id)).toEqual(await original.history(project.id));
      expect(await restored.heads('baseline')).toEqual(BASELINE_TEXTS);
    });

    it('init after restore JOINS newly shipped roots to the baseline without duplicating seeds', async () => {
      // The studio boots the provider, restores, then inits with the FULL shipped-texts map —
      // which can be WIDER than the snapshot (a root shipped after the snapshot was written,
      // e.g. skill documents that load asynchronously). Those roots must join the baseline;
      // roots the baseline already has must not gain a second seed. Both implementations are
      // pinned here so they cannot drift (the git provider has always done this; the simple
      // provider used to skip init entirely once seeded).
      const original = await seededProvider();
      await original.persist();

      const restored = await makeProvider();
      expect(await restored.restore()).toBe(true);
      const wider = new Map([...BASELINE_TEXTS, ['skill-new-thing', 'Shipped skill text.']]);
      await restored.init(wider);

      expect(await restored.heads('baseline')).toEqual(wider);
      // Exactly one seed per pre-existing root — the wider init re-seeded nothing.
      for (const rootKey of BASELINE_TEXTS.keys()) {
        expect(await restored.history('baseline', rootKey)).toHaveLength(1);
      }
      expect(await restored.history('baseline', 'skill-new-thing')).toHaveLength(1);
    });

    it('restores an empty project and saves its first prompt without changing an empty fork', async () => {
      const original = await makeProvider();
      await original.init(new Map());
      const project = await original.createProject('Default');
      expect(await original.heads('baseline')).toEqual(new Map());
      expect(await original.heads(project.id)).toEqual(new Map());
      expect(await original.history(project.id)).toEqual([]);
      await original.persist();

      const restored = await makeProvider();
      expect(await restored.restore()).toBe(true);
      await restored.init(new Map());
      expect(await restored.listProjects()).toEqual([project]);
      expect(await restored.heads(project.id)).toEqual(new Map());
      const fork = await restored.createProject('Empty fork', project.id);
      const first = await restored.commit({
        projectId: project.id,
        rootKey: 'first-prompt',
        text: 'My first prompt.',
        message: 'Create first prompt',
      });
      expect(await restored.heads(project.id)).toEqual(new Map([['first-prompt', 'My first prompt.']]));
      expect(await restored.history(project.id)).toEqual([first]);
      expect(await restored.readTextAt(project.id, first.id, 'first-prompt')).toBe('My first prompt.');
      expect(await restored.heads(fork.id)).toEqual(new Map());
      expect(await restored.history(fork.id)).toEqual([]);
      expect(await restored.readTextAt(fork.id, first.id, 'first-prompt')).toBeNull();
      await restored.init(BASELINE_TEXTS);
      expect(await restored.heads('baseline')).toEqual(BASELINE_TEXTS);
      expect(await restored.history('baseline')).toHaveLength(BASELINE_TEXTS.size);
      expect(await restored.heads(fork.id)).toEqual(new Map());
      await restored.persist();

      const reopened = await makeProvider();
      expect(await reopened.restore()).toBe(true);
      expect(await reopened.history(project.id)).toEqual([first]);
      expect(await reopened.heads(project.id)).toEqual(new Map([['first-prompt', 'My first prompt.']]));
      await reopened.deleteProject(fork.id);
      expect(await reopened.listProjects()).toEqual([project]);
    });
  });
}
