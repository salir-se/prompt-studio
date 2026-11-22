// @module-tag dom
/**
 * Pure, prop-driven tests for the History drawer (ADR-203 Stage C2). Same vanilla
 * `react-dom` + native DOM harness the other panel tests use (no `@testing-library/react` — see
 * `App.test.tsx`'s module doc). The end-to-end provider wiring (load, restore-through-commit,
 * staleness guard) is covered in `App.test.tsx`; this file locks the component's own contract.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryCommitRef } from '../vcs/history-provider';
import { formatCommitTimestamp, HistoryPanel } from './HistoryPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Newest-first, matching the provider's `history()` contract order — index 0 is the current head. */
const COMMITS: readonly HistoryCommitRef[] = [
  { id: 'cccc3333dddd4444', message: 'restore aaaa111', timestampMs: Date.UTC(2026, 0, 3, 12, 30), rootKey: 'scout' },
  { id: 'bbbb2222eeee5555', message: 'edit YOUR MISSION', timestampMs: Date.UTC(2026, 0, 2, 9, 5), rootKey: 'scout' },
  { id: 'aaaa1111ffff6666', message: 'baseline', timestampMs: Date.UTC(2026, 0, 1, 0, 0), rootKey: 'scout' },
];

function commitRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-testid="history-commit-row"]'));
}

function findButtonByAccessibleName(root: ParentNode, name: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll('button')).find(
    (button) => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === name,
  );
  if (!match) throw new Error(`No <button> with accessible name "${name}" found under given root`);
  return match as HTMLButtonElement;
}

function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('HistoryPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  interface RenderOverrides {
    commits?: readonly HistoryCommitRef[];
    busy?: boolean;
    onRestore?: (commitId: string) => void;
    onResetToShipped?: () => void;
    onClose?: () => void;
    error?: string | null;
    onRetry?: () => void;
  }

  function renderPanel(overrides: RenderOverrides = {}): void {
    act(() => {
      root.render(
        <HistoryPanel
          rootTitle="Scout"
          error={overrides.error}
          onRetry={overrides.onRetry}
          commits={overrides.commits ?? COMMITS}
          busy={overrides.busy ?? false}
          onRestore={overrides.onRestore ?? (() => {})}
          onResetToShipped={overrides.onResetToShipped ?? (() => {})}
          onClose={overrides.onClose ?? (() => {})}
        />,
      );
    });
  }

  it('shows a load failure and offers an in-panel retry without a misleading empty state', () => {
    const onRetry = vi.fn();
    renderPanel({ commits: [], error: 'Could not load history: storage unavailable.', onRetry });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not load history');
    expect(container.querySelector('[data-testid="history-empty"]')).toBeNull();
    click(findButtonByAccessibleName(container, 'Retry history'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('retains revisions and restore controls when a restore fails', () => {
    renderPanel({ error: 'Could not restore revision: storage unavailable.' });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not restore revision');
    expect(commitRows()).toHaveLength(COMMITS.length);
    expect(findButtonByAccessibleName(container, 'Restore aaaa111').disabled).toBe(false);
  });

  it('renders the drawer with one row per commit in the given newest-first order', () => {
    renderPanel();

    const drawer = document.querySelector('aside[aria-label="History"]');
    expect(drawer).toBeTruthy();
    expect(drawer?.textContent).toContain('History — Scout');

    const rows = commitRows();
    expect(rows).toHaveLength(COMMITS.length);
    COMMITS.forEach((commit, index) => {
      expect(rows[index].textContent).toContain(commit.message);
      expect(rows[index].textContent).toContain(commit.id.slice(0, 7));
    });
  });

  it('shows each commit an absolute YYYY-MM-DD HH:mm timestamp (deterministic — no relative time)', () => {
    renderPanel();

    const timestamps = Array.from(document.querySelectorAll('[data-testid="history-commit-timestamp"]'));
    expect(timestamps).toHaveLength(COMMITS.length);
    timestamps.forEach((el, index) => {
      expect(el.textContent).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      expect(el.textContent).toBe(formatCommitTimestamp(COMMITS[index].timestampMs));
    });
  });

  it("renders the baseline seed commit as a plain 'baseline' row", () => {
    renderPanel();

    const baselineRow = commitRows().find((row) => row.textContent?.includes('baseline'));
    expect(baselineRow).toBeTruthy();
    expect(baselineRow?.textContent).toContain('aaaa111');
  });

  it("disables ONLY the newest row's Restore with an 'Already the current text' title", () => {
    renderPanel();

    const newest = findButtonByAccessibleName(document.body, 'Restore cccc333');
    expect(newest.disabled).toBe(true);
    expect(newest.getAttribute('title')).toBe('Already the current text');

    for (const older of ['Restore bbbb222', 'Restore aaaa111']) {
      const button = findButtonByAccessibleName(document.body, older);
      expect(button.disabled).toBe(false);
      expect(button.getAttribute('title')).toContain('Replace only Scout');
    }
  });

  it("clicking an older row's Restore calls onRestore with that commit's FULL id", () => {
    const onRestore = vi.fn();
    renderPanel({ onRestore });

    click(findButtonByAccessibleName(document.body, 'Restore aaaa111'));

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith('aaaa1111ffff6666');
  });

  it('shows the empty state when there are no commits and is not busy', () => {
    renderPanel({ commits: [] });

    expect(document.querySelector('[data-testid="history-empty"]')?.textContent).toBe(
      'No history for this section root yet.',
    );
    expect(document.querySelector('[data-testid="history-loading"]')).toBeNull();
    expect(commitRows()).toHaveLength(0);
  });

  it('shows the loading note — not the empty state — while busy', () => {
    renderPanel({ commits: [], busy: true });

    expect(document.querySelector('[data-testid="history-loading"]')?.textContent).toBe('Loading history…');
    expect(document.querySelector('[data-testid="history-empty"]')).toBeNull();
  });

  it('closes on Escape and via the Close button', () => {
    const onClose = vi.fn();
    renderPanel({ onClose });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    click(findButtonByAccessibleName(document.body, 'Close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
