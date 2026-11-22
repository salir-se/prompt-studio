// @module-tag dom
import { fireEvent, render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useStudioShortcuts } from './use-studio-shortcuts';

it('routes desktop shortcuts and preserves browser chords and modal ownership', () => {
  const commands = { addExisting: vi.fn(), explorer: vi.fn(), changeView: vi.fn(() => true), verify: vi.fn() };
  function Harness() {
    useStudioShortcuts({ enabled: true, ...commands });
    return (
      <div role="dialog">
        <input aria-label="Modal input" />
      </div>
    );
  }
  const { getByRole } = render(<Harness />);
  fireEvent.keyDown(document, { key: 'a', altKey: true });
  expect(commands.addExisting).toHaveBeenCalledOnce();
  fireEvent.keyDown(document, { key: 'a', altKey: true, ctrlKey: true });
  fireEvent.keyDown(getByRole('textbox'), { key: 'a', altKey: true });
  expect(commands.addExisting).toHaveBeenCalledOnce();
  fireEvent.keyDown(document, { key: '2', altKey: true });
  expect(commands.changeView).toHaveBeenCalledWith('graph');
});

it('recognizes the physical shortcut key when Option changes its character', () => {
  const addExisting = vi.fn();
  function Harness() {
    useStudioShortcuts({ enabled: true, addExisting, explorer: vi.fn(), changeView: () => true, verify: vi.fn() });
    return null;
  }
  render(<Harness />);
  fireEvent.keyDown(document, { key: 'å', code: 'KeyA', altKey: true });
  expect(addExisting).toHaveBeenCalledOnce();
});

it('focuses Design through its existing command and cycles file references after guarded navigation', async () => {
  // Given: the real command button owns Design availability and navigation guards.
  const design = vi.fn();
  const changeView = vi.fn(() => true);
  function Harness() {
    useStudioShortcuts({ enabled: true, explorer: vi.fn(), changeView, verify: vi.fn() });
    return (
      <>
        <button type="button" aria-keyshortcuts="Alt+3" onClick={design}>
          Design
        </button>
        <div data-studio-panels>
          <button type="button" data-workflow-picker>
            Choose pattern
          </button>
        </div>
        <div data-testid="prompt-graph-canvas">
          <button type="button" data-id="file:first.md">
            first.md
          </button>
          <button type="button" data-id="file:second.md">
            second.md
          </button>
        </div>
      </>
    );
  }
  const { getByRole, container } = render(<Harness />);
  // When: direct navigation replaces unrelated Tab stops.
  fireEvent.keyDown(document, { code: 'Digit3', altKey: true });
  expect(design).toHaveBeenCalledOnce();
  await waitFor(() => expect(getByRole('button', { name: 'Choose pattern' })).toHaveFocus());
  const files = container.querySelectorAll('[data-id]');
  fireEvent.keyDown(document, { code: 'KeyR', altKey: true });
  await waitFor(() => expect(files[0]).toHaveFocus());
  fireEvent.keyDown(files[0], { code: 'KeyR', altKey: true });
  await waitFor(() => expect(files[1]).toHaveFocus());
  fireEvent.keyDown(files[1], { code: 'KeyR', altKey: true });
  await waitFor(() => expect(files[0]).toHaveFocus());
  // Then: cancelled navigation never moves focus or discards the author's place.
  changeView.mockReturnValue(false);
  fireEvent.keyDown(files[0], { code: 'KeyR', altKey: true });
  expect(files[0]).toHaveFocus();
});

it('opens the run workspace with its direct keyboard command', () => {
  const run = vi.fn();
  function Harness() {
    useStudioShortcuts({ enabled: true, explorer: vi.fn(), changeView: () => true, verify: vi.fn() });
    return (
      <button type="button" aria-keyshortcuts="Alt+4" onClick={run}>
        Run
      </button>
    );
  }
  render(<Harness />);
  fireEvent.keyDown(document, { code: 'Digit4', altKey: true });
  expect(run).toHaveBeenCalledOnce();
});

it('#2490: toggles evaluations from its own fields while leaving nested dialogs and other panel shortcuts alone', () => {
  const toggle = vi.fn();
  const verify = vi.fn();
  function Harness() {
    useStudioShortcuts({ enabled: true, explorer: vi.fn(), changeView: () => true, verify });
    return (
      <>
        <button type="button" aria-keyshortcuts="Alt+5" onClick={toggle}>
          Toggle evaluations
        </button>
        <div data-studio-panels role="dialog" aria-label="Prompt workspace">
          <aside data-evaluation-dock>
            <input aria-label="Test name" />
            <div role="dialog" aria-label="Covering dialog">
              <input aria-label="Modal value" />
            </div>
          </aside>
        </div>
      </>
    );
  }
  const { getByRole } = render(<Harness />);
  fireEvent.keyDown(getByRole('textbox', { name: 'Test name' }), { code: 'Digit5', altKey: true });
  expect(toggle).toHaveBeenCalledOnce();
  fireEvent.keyDown(getByRole('textbox', { name: 'Modal value' }), { code: 'Digit5', altKey: true });
  expect(toggle).toHaveBeenCalledOnce();
  fireEvent.keyDown(getByRole('textbox', { name: 'Test name' }), { code: 'KeyV', altKey: true });
  expect(verify).not.toHaveBeenCalled();
});
