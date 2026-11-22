// @module-tag dom
import { fireEvent } from '@testing-library/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildToolDirectory } from '../catalog/tool-directory';
import { ToolsPanel } from './ToolsPanel';

// The panel lists the content source's tool arrays; the public build bundles none, so this suite
// supplies a primed source with two prompts' tools.
vi.mock('../catalog/prompt-content-source', () => ({
  bundledPromptContentSource: {
    getPromptText: () => null,
    getToolSourceLists: () => [
      {
        source: 'support-triage',
        tools: [
          { name: 'lookup_customer', description: 'Find the customer record by email.', inputKeys: ['email'] },
          { name: 'create_ticket', description: 'Open a support ticket.', inputKeys: ['category', 'urgency'] },
        ],
      },
      { source: 'release-notes', tools: [{ name: 'list_changes', inputKeys: [] }] },
    ],
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ToolsPanel', () => {
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

  it('searches by name and agent, filters the selected prompt and clears back to all tools', () => {
    // Given: the drawer, with the first tool used by the current prompt
    const first = buildToolDirectory()[0];
    expect(buildToolDirectory()).toHaveLength(3);
    act(() => root.render(<ToolsPanel onClose={() => {}} usedToolNames={[first.name]} />));
    // When: the search matches nothing, then a name; Then: the list follows; the usage filter keeps one tool
    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'no-tool-has-this-name' } });
    expect(container.textContent).toContain('No tools match these filters.');
    expect(container.querySelectorAll('[data-testid="tool-definition-node"]')).toHaveLength(0);
    fireEvent.change(search, { target: { value: first.name } });
    expect(container.textContent).toContain(first.name);
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.click(container.querySelector('input[type="checkbox"]')!);
    expect(container.querySelectorAll('[data-testid="tool-definition-node"]')).toHaveLength(1);
    const clear = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Clear filter');
    fireEvent.click(clear!);
    expect(container.querySelectorAll('[data-testid="tool-definition-node"]')).toHaveLength(
      buildToolDirectory().length,
    );
  });

  it('renders the drawer header count and one tool-definition-node per directory entry, closing on Close', () => {
    // Given / When: the drawer renders; Then: the header counts the tools, one node each, and Close calls onClose
    let closed = false;
    act(() => {
      root.render(<ToolsPanel onClose={() => (closed = true)} />);
    });

    const drawer = document.querySelector('[data-testid="tools-drawer"]');
    expect(drawer).toBeTruthy();
    expect(drawer?.textContent).toContain(`(${buildToolDirectory().length})`);

    const nodes = document.querySelectorAll('[data-testid="tool-definition-node"]');
    expect(nodes.length).toBe(buildToolDirectory().length);

    const closeButton = document.querySelector('[aria-label="Close"]');
    act(() => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(closed).toBe(true);
  });
});
