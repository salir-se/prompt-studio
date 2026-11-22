// @module-tag dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptWriter } from '../components/PromptWriter';
import { ShortcutControl } from './ShortcutControl';
import { ShortcutEducation, ShortcutHelpMenu } from './ShortcutEducation';

afterEach(() => {
  localStorage.removeItem('prompt-studio:shortcut-tips:v1');
  localStorage.removeItem('prompt-studio:compact-toolbars:v1');
  localStorage.removeItem('prompt-studio:line-numbers:v1');
  vi.useRealTimers();
});

function workspace() {
  return render(
    <ShortcutEducation>
      <ShortcutHelpMenu onAssistant={vi.fn()} />
      <PromptWriter
        text={'<mission>\nWrite instructions.\n</mission>'}
        dirty={false}
        variables={[]}
        tools={[]}
        onChange={vi.fn()}
        onApply={vi.fn()}
        onDiscard={vi.fn()}
      />
    </ShortcutEducation>,
  );
}

it('teaches a pointer action, opens its section search, and can turn tips off persistently', async () => {
  workspace();
  fireEvent.click(screen.getByRole('button', { name: /Sections/ }), { detail: 1 });
  expect(screen.getByRole('dialog', { name: 'Jump to section' })).toBeVisible();
  expect(await screen.findByRole('status', { name: 'Shortcut tip' })).toHaveTextContent('Alt');
  fireEvent.click(screen.getByRole('button', { name: 'Turn off tips' }));
  expect(localStorage.getItem('prompt-studio:shortcut-tips:v1')).toBe('false');
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Shortcut tip' })).not.toBeInTheDocument());
});

it('does not carry an open tip into the next workspace after the app closes', async () => {
  // Given: a shortcut tip is showing
  const app = workspace();
  fireEvent.click(screen.getByRole('button', { name: /Sections/ }), { detail: 1 });
  expect(await screen.findByRole('status', { name: 'Shortcut tip' })).toBeVisible();
  // When: the app closes and a new workspace opens
  app.unmount();
  workspace();
  // Then: the old tip does not reappear (Sonner replays undismissed toasts to a new Toaster)
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(screen.queryByRole('status', { name: 'Shortcut tip' })).not.toBeInTheDocument();
});

it('does not teach keyboard or programmatic activation', () => {
  workspace();
  fireEvent.click(screen.getByRole('button', { name: /Sections/ }), { detail: 0 });
  expect(screen.getByRole('dialog', { name: 'Jump to section' })).toBeVisible();
  expect(screen.queryByRole('status', { name: 'Shortcut tip' })).not.toBeInTheDocument();
});

async function helpItem(name: string) {
  const help = screen.getByRole('button', { name: 'Help' });
  help.focus();
  fireEvent.pointerDown(help, { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

it('opens a searchable offline guide from Help and returns focus without changing the prompt', async () => {
  workspace();
  await helpItem('Keyboard shortcuts');
  expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Find a shortcut' })).toHaveFocus();
  fireEvent.change(screen.getByRole('textbox', { name: 'Find a shortcut' }), { target: { value: 'subsection' } });
  expect(screen.getByText('Add subsection')).toBeVisible();
  expect(screen.queryByText('Open Run')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Find a shortcut' }), { target: { value: 'nothing-matches' } });
  expect(screen.getByText(/No matching shortcuts/)).toBeVisible();
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Find a shortcut' }), { key: 'Escape' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Help' })).toHaveFocus());
  expect(screen.getByRole('textbox', { name: 'Prompt markdown' })).toHaveValue(
    '<mission>\nWrite instructions.\n</mission>',
  );
});

it('keeps the preference off after reopening the app while retaining tooltips', async () => {
  const app = workspace();
  await helpItem('App settings');
  const toggle = await screen.findByRole('switch', { name: 'Show shortcut tips' });
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  expect(toggle).not.toBeChecked();
  app.unmount();
  workspace();
  const sections = screen.getByRole('button', { name: /Sections/ });
  fireEvent.focus(sections);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Alt');
  fireEvent.click(sections, { detail: 1 });
  expect(screen.getByRole('dialog', { name: 'Jump to section' })).toBeVisible();
  expect(screen.queryByRole('status', { name: 'Shortcut tip' })).not.toBeInTheDocument();
});

it('shows one tip per action per session with a cooldown and no queue', () => {
  vi.useFakeTimers();
  render(
    <ShortcutEducation>
      <ShortcutControl id="write">
        <button type="button">Write</button>
      </ShortcutControl>
      <ShortcutControl id="graph">
        <button type="button">Graph</button>
      </ShortcutControl>
    </ShortcutEducation>,
  );
  // Sonner shows a toast on the next task and removes it after a short exit animation.
  const click = (name: string) => {
    fireEvent.click(screen.getByRole('button', { name }), { detail: 1 });
    act(() => vi.advanceTimersByTime(0));
  };
  click('Write');
  expect(screen.getByRole('status', { name: 'Shortcut tip' })).toHaveTextContent('1');
  click('Graph');
  expect(screen.getAllByRole('status', { name: 'Shortcut tip' })).toHaveLength(1);
  act(() => vi.advanceTimersByTime(6000));
  // The dismissal, the exit animation and the unmount each run on their own timer, after a render.
  for (let step = 0; step < 4; step++) act(() => vi.advanceTimersByTime(250));
  expect(screen.queryByRole('status', { name: 'Shortcut tip' })).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(23_000));
  click('Write');
  expect(screen.queryByRole('status', { name: 'Shortcut tip' })).not.toBeInTheDocument();
  click('Graph');
  expect(screen.getByRole('status', { name: 'Shortcut tip' })).toHaveTextContent('2');
});

it('reports a failed preference save while keeping the current session usable', async () => {
  workspace();
  await helpItem('App settings');
  const toggle = await screen.findByRole('switch', { name: 'Show shortcut tips' });
  const storage = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('Unavailable');
  });
  fireEvent.click(toggle);
  expect(toggle).not.toBeChecked();
  expect(screen.getByRole('status')).toHaveTextContent('Changed for this session');
  storage.mockRestore();
});

it('can restore labelled toolbars and retain both app preferences after reopening', async () => {
  const app = workspace();
  await helpItem('App settings');
  const compact = await screen.findByRole('switch', { name: 'Compact toolbars' });
  expect(compact).toBeChecked();
  fireEvent.click(compact);
  expect(localStorage.getItem('prompt-studio:compact-toolbars:v1')).toBe('false');
  expect(screen.getByRole('switch', { name: 'Show shortcut tips' })).toBeChecked();
  app.unmount();
  workspace();
  await helpItem('App settings');
  expect(await screen.findByRole('switch', { name: 'Compact toolbars' })).not.toBeChecked();
  expect(screen.getByRole('switch', { name: 'Show shortcut tips' })).toBeChecked();
});

it('toggles editor line numbers and retains the preference across app and Settings reopening', async () => {
  const app = workspace();
  const input = screen.getByRole('textbox', { name: 'Prompt markdown' });
  const toggle = screen.getByRole('button', { name: 'Line numbers' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('textbox', { name: 'Prompt markdown' })).toBe(input);
  expect(screen.getAllByTestId('prompt-line-number')).toHaveLength(3);
  expect(localStorage.getItem('prompt-studio:line-numbers:v1')).toBe('true');
  app.unmount();
  workspace();
  expect(screen.getByRole('button', { name: 'Line numbers' })).toHaveAttribute('aria-pressed', 'true');
  await helpItem('App settings');
  fireEvent.click(await screen.findByRole('switch', { name: 'Editor line numbers' }));
  expect(localStorage.getItem('prompt-studio:line-numbers:v1')).toBe('false');
});
