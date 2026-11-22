// @module-tag dom
import { PROMPT_VARIABLE_DOCS } from '@prompt-studio/prompts';
import { fireEvent, screen } from '@testing-library/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flattenVariableDocs, VariablesPanel } from './VariablesPanel';

// The public build documents no built-in variables; a host application's docs are supplied here.
vi.mock('@prompt-studio/prompts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@prompt-studio/prompts')>()),
  PROMPT_VARIABLE_DOCS: (await import('../test-fixtures/host-variable-docs')).HOST_VARIABLE_DOCS,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('flattenVariableDocs', () => {
  it('dedupes a variable declared by multiple prompt keys, merging the prompt-key list', () => {
    // Given: company_name is documented by both prompt keys
    // When: the docs are flattened
    const flattened = flattenVariableDocs();
    // Then: one row lists both prompt keys
    const companyName = flattened.find((variable) => variable.key === 'company_name');
    expect(companyName).toBeTruthy();
    expect(companyName?.promptKeys.length).toBeGreaterThan(1);
    expect(companyName?.promptKeys).toContain('support-triage');
  });

  it('is sorted by key and deterministic', () => {
    // Given / When / Then: keys are sorted and stable across calls
    const first = flattenVariableDocs();
    const keys = first.map((v) => v.key);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    expect(flattenVariableDocs()).toEqual(first);
  });

  it('defaults required to true when a doc omits it, and respects explicit false', () => {
    // Given: product_name omits `required`, change_list sets it to false
    const flattened = flattenVariableDocs();
    // Then: required defaults to true and an explicit false is kept
    const alwaysPresent = flattened.find((variable) => variable.key === 'product_name');
    expect(alwaysPresent?.required).toBe(true);

    const optional = flattened.find((variable) => variable.key === 'change_list');
    expect(optional?.required).toBe(false);
  });

  it('covers every prompt key currently registered in PROMPT_VARIABLE_DOCS', () => {
    // Given / When / Then: every documented prompt key appears on some row
    const flattened = flattenVariableDocs();
    const allPromptKeys = new Set(flattened.flatMap((v) => v.promptKeys));
    for (const promptKey of Object.keys(PROMPT_VARIABLE_DOCS)) {
      if (PROMPT_VARIABLE_DOCS[promptKey].variables.length === 0) continue;
      expect(allPromptKeys.has(promptKey)).toBe(true);
    }
  });
});

describe('VariablesPanel', () => {
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

  it('finds variables by purpose or name and filters current prompt usage without changing declarations', () => {
    // Given: the drawer, with product_name used by the current prompt
    act(() => root.render(<VariablesPanel onClose={() => {}} usedVariableNames={['product_name']} />));
    // When: the search matches nothing, then a name; Then: the list follows; the usage filter keeps one row
    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'unknown-variable-unique' } });
    expect(container.querySelectorAll('[data-testid="variable-directory-row"]')).toHaveLength(0);
    expect(container.textContent).toContain('No variables match these filters.');
    fireEvent.change(search, { target: { value: 'product_name' } });
    expect(container.querySelector('[data-testid="variable-directory-row"]')?.textContent).toContain(
      '{{product_name}}',
    );
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.click(container.querySelector('input[type="checkbox"]')!);
    expect(container.querySelectorAll('[data-testid="variable-directory-row"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="declare-variable-form"]')).toBeTruthy();
    const clear = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Clear filter');
    fireEvent.click(clear!);
    expect(container.querySelectorAll('[data-testid="variable-directory-row"]')).toHaveLength(
      flattenVariableDocs().length,
    );
  });

  it('renders the drawer with a row per known variable and closes via the Close button', () => {
    // Given / When: the drawer renders; Then: one row per variable, and Close calls onClose
    let closed = false;
    act(() => {
      root.render(<VariablesPanel onClose={() => (closed = true)} />);
    });

    const drawer = document.querySelector('[data-testid="variables-drawer"]');
    expect(drawer).toBeTruthy();
    const rows = document.querySelectorAll('[data-testid="variable-directory-row"]');
    expect(rows.length).toBe(flattenVariableDocs().length);

    const closeButton = screen.getByRole('button', { name: /^Close$/ });
    expect(closeButton).toBeTruthy();
    act(() => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(closed).toBe(true);
  });
});
