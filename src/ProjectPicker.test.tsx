// @module-tag dom
/**
 * BDD tests for `ProjectPicker` — pure and prop-driven (see the component's module doc): every test
 * feeds props in, drives the popover through real DOM events, and observes only callbacks and
 * rendered output — no history provider anywhere. Vanilla `react-dom` + native DOM helpers, the
 * same pattern as `App.test.tsx` (see its module doc for why `@testing-library` is not used here).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPicker, type ProjectPickerProps } from './ProjectPicker';

// Silences React's "not configured to support act(...)" warning — this file drives `act()` directly.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function byTestId(testId: string): HTMLElement {
  const el = document.querySelector(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`No element found for data-testid="${testId}"`);
  return el as HTMLElement;
}

function queryByTestId(testId: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testId}"]`);
}

/** Matches a button by its accessible name — `aria-label` when present, else trimmed text content. */
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

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function findInputByAccessibleName(root: ParentNode, name: string): HTMLInputElement {
  const match = Array.from(root.querySelectorAll('input')).find((input) => input.getAttribute('aria-label') === name);
  if (!match) throw new Error(`No <input aria-label="${name}"> found under given root`);
  return match as HTMLInputElement;
}

function pressEscape(): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

describe('ProjectPicker', () => {
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

  /** Renders the picker with two projects (`Default` active) unless overridden; returns the props. */
  function renderPicker(overrides: Partial<ProjectPickerProps> = {}): ProjectPickerProps {
    const props: ProjectPickerProps = {
      projects: [
        { id: 'default', name: 'Default' },
        { id: 'b', name: 'B' },
      ],
      activeId: 'default',
      baselines: [
        {
          id: 'default',
          label: 'Your prompts',
          description: 'The shipped prompt set.',
          positioning: 'shipped',
        },
        {
          id: 'job-seeker-personal-broker',
          label: 'Job Seeker — personal broker (reference)',
          description: 'Calibration reference configuration.',
          positioning: 'reference',
        },
      ],
      onSwitch: vi.fn(),
      onCreate: vi.fn(),
      onRename: vi.fn(),
      onDuplicate: vi.fn(),
      onDelete: vi.fn(),
      onReset: vi.fn(),
      ...overrides,
    };
    act(() => {
      root.render(<ProjectPicker {...props} />);
    });
    return props;
  }

  function openMenu(): HTMLElement {
    click(byTestId('project-picker-trigger'));
    return byTestId('project-picker-menu');
  }

  it('shows the active project name on the trigger and lists every project with the active one marked', () => {
    renderPicker();

    expect(byTestId('project-picker-trigger').textContent).toContain('Default');
    expect(queryByTestId('project-picker-menu')).toBeNull();

    const menu = openMenu();
    const defaultButton = findButtonByAccessibleName(menu, 'Default');
    const bButton = findButtonByAccessibleName(menu, 'B');
    expect(defaultButton.getAttribute('aria-current')).toBe('true');
    expect(bButton.getAttribute('aria-current')).toBeNull();
  });

  it('dismisses the configuration popover when clicking outside it', () => {
    renderPicker();
    openMenu();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(queryByTestId('project-picker-menu')).toBeNull();
  });

  it('reports a switch through onSwitch and closes the menu', () => {
    const props = renderPicker();

    click(findButtonByAccessibleName(openMenu(), 'B'));

    expect(props.onSwitch).toHaveBeenCalledWith('b');
    expect(queryByTestId('project-picker-menu')).toBeNull();
  });

  it('creates a project with the entered name via the inline form', () => {
    const props = renderPicker();
    const menu = openMenu();

    click(findButtonByAccessibleName(menu, 'New configuration'));
    setInputValue(findInputByAccessibleName(menu, 'Configuration name'), '  My Project  ');
    click(findButtonByAccessibleName(menu, 'Create configuration'));

    expect(props.onCreate).toHaveBeenCalledWith('My Project', 'default');
    expect(queryByTestId('project-picker-menu')).toBeNull();
  });

  it('never submits an empty or whitespace-only name', () => {
    const props = renderPicker();
    const menu = openMenu();

    click(findButtonByAccessibleName(menu, 'New configuration'));
    expect(findButtonByAccessibleName(menu, 'Create configuration').disabled).toBe(true);

    setInputValue(findInputByAccessibleName(menu, 'Configuration name'), '   ');
    expect(findButtonByAccessibleName(menu, 'Create configuration').disabled).toBe(true);

    // Even a direct form submit (bypassing the disabled button) must not fire the callback.
    const form = menu.querySelector('form');
    act(() => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(queryByTestId('project-picker-menu')).toBeTruthy();
  });

  it('prefills rename with the current name and reports onRename with the new one', () => {
    const props = renderPicker();
    const menu = openMenu();

    click(findButtonByAccessibleName(menu, 'Rename B'));
    const input = findInputByAccessibleName(menu, 'Configuration name');
    expect(input.value).toBe('B');

    setInputValue(input, 'Better');
    click(findButtonByAccessibleName(menu, 'Rename configuration'));

    expect(props.onRename).toHaveBeenCalledWith('b', 'Better');
  });

  it('prefills duplicate with a "copy" name and reports onDuplicate', () => {
    const props = renderPicker();
    const menu = openMenu();

    click(findButtonByAccessibleName(menu, 'Duplicate Default'));
    const input = findInputByAccessibleName(menu, 'Configuration name');
    expect(input.value).toBe('Default copy');

    click(findButtonByAccessibleName(menu, 'Duplicate configuration'));

    expect(props.onDuplicate).toHaveBeenCalledWith('default', 'Default copy');
  });

  it('seeds from the selected reference baseline on create', () => {
    const props = renderPicker();
    const menu = openMenu();

    click(findButtonByAccessibleName(menu, 'New configuration'));
    const select = menu.querySelector('select[aria-label="Starting configuration"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, 'job-seeker-personal-broker');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    setInputValue(findInputByAccessibleName(menu, 'Configuration name'), 'Trial');
    click(findButtonByAccessibleName(menu, 'Create configuration'));

    expect(props.onCreate).toHaveBeenCalledWith('Trial', 'job-seeker-personal-broker');
  });

  it('defaults the start-from select to the shipped baseline', () => {
    renderPicker();
    const menu = openMenu();

    click(findButtonByAccessibleName(menu, 'New configuration'));
    const select = menu.querySelector('select[aria-label="Starting configuration"]') as HTMLSelectElement;
    expect(select.value).toBe('default');
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Your prompts',
      'Job Seeker — personal broker (reference)',
    ]);
  });

  it('resets a configuration only on the second, confirming click', () => {
    const props = renderPicker();
    const menu = openMenu();

    click(findButtonByAccessibleName(menu, 'Reset B to its starting configuration'));
    expect(props.onReset).not.toHaveBeenCalled();

    click(findButtonByAccessibleName(menu, 'Confirm reset B'));
    expect(props.onReset).toHaveBeenCalledWith('b');
    expect(queryByTestId('project-picker-menu')).toBeNull();
  });

  it('deletes only on the second, confirming click', () => {
    const props = renderPicker();
    const menu = openMenu();

    click(findButtonByAccessibleName(menu, 'Delete B'));
    expect(props.onDelete).not.toHaveBeenCalled();

    click(findButtonByAccessibleName(menu, 'Confirm delete B'));
    expect(props.onDelete).toHaveBeenCalledWith('b');
    expect(queryByTestId('project-picker-menu')).toBeNull();
  });

  it('disables Delete for the last remaining project', () => {
    renderPicker({ projects: [{ id: 'default', name: 'Default' }] });
    const menu = openMenu();

    const deleteButton = findButtonByAccessibleName(menu, 'Delete Default');
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.getAttribute('title')).toMatch(/last project/i);
  });

  it('closes on Escape, dropping any half-entered state', () => {
    const props = renderPicker();
    const menu = openMenu();

    click(findButtonByAccessibleName(menu, 'New configuration'));
    setInputValue(findInputByAccessibleName(menu, 'Configuration name'), 'Half typed');

    pressEscape();

    expect(queryByTestId('project-picker-menu')).toBeNull();
    expect(props.onCreate).not.toHaveBeenCalled();

    // Reopening starts clean — no leftover inline form.
    expect(openMenu().querySelector('form')).toBeNull();
  });
});
