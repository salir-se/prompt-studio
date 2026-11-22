// @module-tag dom
import { expect, it, vi } from 'vitest';
import { appTests } from './App.test-harness';
import { SimpleHistoryProvider } from './vcs/simple-history-provider';

// The retry flow exercises the real drawer and history provider without rendering the prompt graph.
vi.mock('./references/ProjectGraphWorkspace', () => ({ ProjectGraphWorkspace: () => null }));

appTests(
  ({
    byTestId,
    findButtonByAccessibleName,
    click,
    flushUntil,
    settleHistoryWrites,
    renderBootedApp,
    starterRootTestId,
  }) => {
    it('retries a failed history load while the same drawer remains open', async () => {
      // Given: Support Triage is open and the next history read fails once
      await renderBootedApp();
      click(byTestId(starterRootTestId));
      await settleHistoryWrites();
      const historyRead = vi
        .spyOn(SimpleHistoryProvider.prototype, 'history')
        .mockRejectedValueOnce(new Error('Storage temporarily unavailable'));

      // When: the History drawer opens, shows the failure, and the author retries
      click(findButtonByAccessibleName(document.body, 'History'));
      const drawer = byTestId('history-drawer');
      await flushUntil(() => (drawer.textContent ?? '').includes('Could not load history'));
      expect(historyRead).toHaveBeenCalledTimes(1);

      // Then: the same drawer loads the history on retry
      click(findButtonByAccessibleName(drawer, 'Retry history'));
      await flushUntil(() => drawer.querySelector('[data-testid="history-commit-row"]') !== null);
      expect(historyRead).toHaveBeenCalledTimes(2);
      expect(byTestId('history-drawer')).toBe(drawer);
      expect(drawer.querySelector('[role="alert"]')).toBeNull();
    });
  },
);
