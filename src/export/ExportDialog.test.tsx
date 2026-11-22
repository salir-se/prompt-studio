// @module-tag dom
/**
 * BDD tests for `ExportDialog` — allowed summary, refused reason list + force checkbox, cancel and
 * Escape. Same vanilla `react-dom` `createRoot`/`act` technique as `App.test.tsx` (see its module
 * doc for why this app does not use `@testing-library/react`).
 */

import type { PromptVerificationFinding } from '@prompt-studio/prompts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportDialog, type ExportDialogProps } from './ExportDialog';
import { describeRefusalReason, evaluateExportGate, type ExportGateResult } from './export-gate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Minimal error-severity finding satisfying the real union — only fields the gate reads matter here. */
const ERROR_FINDING: PromptVerificationFinding = {
  source: 'deterministic',
  scope: 'consolidated',
  profile: { id: 'legacy-consolidated-test', version: 1 },
  ruleId: 'required-section',
  severity: 'error',
  enforcement: 'activation',
  message: 'Required section MISSION is missing.',
};

const ALLOWED_GATE: ExportGateResult = evaluateExportGate({ undeclaredVariables: [], findings: [] });
const REFUSED_GATE: ExportGateResult = evaluateExportGate({
  undeclaredVariables: ['mystery'],
  findings: [ERROR_FINDING],
});

function findButtonByName(name: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === name);
  if (!match) throw new Error(`No <button> named "${name}" found`);
  return match as HTMLButtonElement;
}

function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('ExportDialog', () => {
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

  function renderDialog(overrides: Partial<ExportDialogProps> = {}): ExportDialogProps {
    const props: ExportDialogProps = {
      open: true,
      rootTitle: 'Scout',
      gate: ALLOWED_GATE,
      sectionCount: 3,
      variableCount: 2,
      archivePaths: [
        'packages/prompts/src/blueprints/scout/sections/01-mission.md',
        'packages/prompts/src/blueprints/scout/design.json',
        'packages/prompts/src/blueprints/scout/manifest.json',
      ],
      onCancel: vi.fn(),
      onExport: vi.fn(),
      ...overrides,
    };
    act(() => {
      root.render(<ExportDialog {...props} />);
    });
    return props;
  }

  it('allowed: shows the section/variable summary and exports unforced from the enabled button', () => {
    const props = renderDialog();

    expect(document.querySelector('[data-testid="export-summary"]')?.textContent).toContain('3 sections, 2 variables');
    const exportButton = findButtonByName('Export ZIP');
    expect(exportButton.disabled).toBe(false);

    click(exportButton);
    expect(props.onExport).toHaveBeenCalledWith(false);
  });

  it('keeps the ZIP tree collapsed by default and reveals the actual archive paths on demand', () => {
    renderDialog();

    const preview = document.querySelector('[data-testid="export-zip-preview"]') as HTMLDetailsElement;
    expect(preview).toBeTruthy();
    expect(preview.open).toBe(false);
    expect(preview.textContent).toContain('ZIP contents (3 files)');

    click(preview.querySelector('summary') as HTMLElement);

    expect(preview.open).toBe(true);
    const tree = document.querySelector('[aria-label="ZIP archive file tree"]');
    expect(tree?.textContent).toContain('sections');
    expect(tree?.textContent).toContain('01-mission.md');
    expect(tree?.textContent).toContain('design.json');
    expect(tree?.textContent).toContain('manifest.json');
  });

  it('refused: lists every reason verbatim, disables Export ZIP until the force checkbox is checked', () => {
    const props = renderDialog({ gate: REFUSED_GATE });

    const reasons = document.querySelector('[data-testid="export-refusal-reasons"]');
    expect(reasons).toBeTruthy();
    expect(reasons?.querySelectorAll('li')).toHaveLength(REFUSED_GATE.reasons.length);
    for (const reason of REFUSED_GATE.reasons) {
      expect(reasons?.textContent).toContain(describeRefusalReason(reason));
    }

    expect(findButtonByName('Export ZIP').disabled).toBe(true);

    const checkbox = document.querySelector('[data-testid="export-force-checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    click(checkbox);

    const exportButton = findButtonByName('Export ZIP');
    expect(exportButton.disabled).toBe(false);
    click(exportButton);
    expect(props.onExport).toHaveBeenCalledWith(true);
  });

  it('cancel button calls onCancel and never onExport', () => {
    const props = renderDialog({ gate: REFUSED_GATE });

    click(findButtonByName('Cancel'));

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onExport).not.toHaveBeenCalled();
  });

  it('renders the ungated Project archive button and calls its handler even while the gate refuses', () => {
    const onExportProjectArchive = vi.fn();
    renderDialog({ gate: REFUSED_GATE, onExportProjectArchive });

    const archiveButton = findButtonByName('Project archive');
    expect(archiveButton.disabled).toBe(false);
    expect(archiveButton.getAttribute('title')).toBe('Full project save-file including history — not a repo overlay');
    // The gate governs ONLY the overlay export — the save-file needs no gate (ADR-203 decision 5).
    expect(findButtonByName('Export ZIP').disabled).toBe(true);

    click(archiveButton);
    expect(onExportProjectArchive).toHaveBeenCalledTimes(1);
  });

  it('omits the Project archive button while no handler is wired (history provider still booting)', () => {
    renderDialog();

    const archiveButtons = Array.from(document.querySelectorAll('button')).filter(
      (button) => button.textContent?.trim() === 'Project archive',
    );
    expect(archiveButtons).toHaveLength(0);
  });

  it('Escape triggers onCancel, matching the app-wide dialog escape handling', () => {
    const props = renderDialog();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
});
