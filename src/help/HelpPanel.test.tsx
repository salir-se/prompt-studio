// @module-tag dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpPanel, loadHelpApiKey, type SendFn } from './HelpPanel';

/**
 * The help assistant's observable behavior (task #16): sign-in persists the z.ai key in this
 * browser, questions go through the injectable client with the studio-knowledge system prompt,
 * answers render in the transcript, and failures surface as an alert without losing the question.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONTEXT = { manifestName: 'salir', rootCount: 23, selectedRootTitle: 'Scout' };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function byTestId(testId: string): HTMLElement {
  const el = container.querySelector(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`No element for ${testId}`);
  return el as HTMLElement;
}

function inputByLabel(label: string): HTMLInputElement {
  // The sign-in field is labelled via <label htmlFor>; the chat input via aria-label.
  const el = container.querySelector(`input[aria-label="${label}"], input#${label}`);
  if (!el) throw new Error(`No input ${label}`);
  return el as HTMLInputElement;
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function clickButton(label: string): void {
  const button = Array.from(container.querySelectorAll('button')).find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === label,
  );
  if (!button) throw new Error(`No button ${label}`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function renderPanel(send?: SendFn): void {
  act(() => {
    root.render(<HelpPanel context={CONTEXT} onClose={() => {}} {...(send !== undefined ? { send } : {})} />);
  });
}

describe('HelpPanel', () => {
  it('shows the sign-in form first; signing in persists the key in localStorage', () => {
    renderPanel();
    expect(byTestId('help-messages')).toBeTruthy();
    setInput(inputByLabel('help-api-key'), 'sk-help-key');
    clickButton('Connect z.ai');
    expect(loadHelpApiKey()).toBe('sk-help-key');
    // The chat input unlocks once signed in.
    expect(inputByLabel('Ask the help assistant').disabled).toBe(false);
  });

  it('discloses browser storage before collecting a key and provides guidance without a connection', () => {
    const send = vi.fn();
    renderPanel(send);
    expect(container.querySelector('input#help-api-key')?.getAttribute('aria-describedby')).toBe('help-key-storage');
    expect(container.querySelector('#help-key-storage')?.textContent).toContain('across sessions');
    expect(container.textContent).toContain('Quick guide · no connection needed');
    expect(container.textContent).toContain('Versions creates a named project checkpoint');
    expect(send).not.toHaveBeenCalled();
  });

  it('answers a question through the injected client with the grounded system prompt', async () => {
    const send = vi.fn(async ({ system }: Parameters<SendFn>[0]) => {
      expect(system).toContain('Salir Prompt Studio');
      expect(system).toContain('Scout');
      return { text: 'Open the History drawer and press "Reset this prompt to starting text".' };
    });
    localStorage.setItem('prompt-studio:help:zai-key:v1', 'sk-help-key'); // signed in already
    renderPanel(send);

    setInput(inputByLabel('Ask the help assistant'), 'how do I roll back my edit?');
    clickButton('Ask');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(byTestId('help-messages').textContent).toContain('roll back my edit?');
    expect(byTestId('help-messages').textContent).toContain('Reset this prompt to starting text');
  });

  it('surfaces a client failure as an alert and keeps the question in the transcript', async () => {
    const send = vi.fn(async () => {
      throw new Error('z.ai request failed (HTTP 401)');
    });
    localStorage.setItem('prompt-studio:help:zai-key:v1', 'sk-help-key'); // signed in already
    renderPanel(send);

    setInput(inputByLabel('Ask the help assistant'), 'broken?');
    clickButton('Ask');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('HTTP 401');
    expect(byTestId('help-messages').textContent).toContain('broken?');
  });

  it('sign-out clears the stored key and the transcript', () => {
    localStorage.setItem('prompt-studio:help:zai-key:v1', 'sk-keep');
    renderPanel();
    clickButton('Disconnect the help assistant');
    expect(loadHelpApiKey()).toBe('');
  });
});
