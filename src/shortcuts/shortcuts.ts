export const SHORTCUTS = {
  explorer: {
    label: 'Toggle prompt explorer',
    keys: 'Alt+E',
    group: 'Navigation',
    scope: 'Main workspace; covering dialogs keep their own keys.',
  },
  write: {
    label: 'Write and focus editor',
    keys: 'Alt+1',
    group: 'Navigation',
    scope: 'Main workspace, with a prompt selected.',
  },
  graph: { label: 'Show graph', keys: 'Alt+2', group: 'Navigation', scope: 'Main workspace, with a prompt selected.' },
  design: {
    label: 'Design and workflow patterns',
    keys: 'Alt+3',
    group: 'Navigation',
    scope: 'Main workspace; requires a Studio-authored prompt.',
  },
  run: { label: 'Open Run', keys: 'Alt+4', group: 'Navigation', scope: 'Main workspace in an open project.' },
  evaluations: {
    label: 'Toggle evaluation tests',
    keys: 'Alt+5',
    group: 'Navigation',
    scope: 'Show or hide the bottom panel in an open project. Unfinished tests and results stay available.',
  },
  addExisting: {
    label: 'Add existing prompt',
    keys: 'Alt+A',
    group: 'Navigation',
    scope: 'Main workspace in an open project.',
  },
  verify: {
    label: 'Verify prompt',
    keys: 'Alt+V',
    group: 'Navigation',
    scope: 'Main workspace; select a verifiable prompt.',
  },
  reference: {
    label: 'Focus next file reference',
    keys: 'Alt+R',
    group: 'Graph and files',
    scope: 'Main workspace; switches to Graph and cycles through file nodes.',
  },
  openFile: {
    label: 'Open referenced file',
    keys: 'Enter',
    group: 'Graph and files',
    scope: 'Focus a resolved text-file node in Graph; double-click also opens it.',
  },
  saveFile: {
    label: 'Save referenced file',
    keys: 'Control+S Meta+S',
    group: 'Graph and files',
    scope: 'Referenced-file editor; requires changes and no stale-file conflict.',
  },
  jump: {
    label: 'Jump to section',
    keys: 'Alt+J',
    group: 'Writing',
    scope: 'Write editor and composing toolbar. Searches the current draft.',
  },
  previous: { label: 'Previous section', keys: 'Alt+ArrowUp', group: 'Writing', scope: 'Prompt markdown editor.' },
  next: { label: 'Next section', keys: 'Alt+ArrowDown', group: 'Writing', scope: 'Prompt markdown editor.' },
  addSection: {
    label: 'Add section',
    keys: 'Alt+N',
    group: 'Writing',
    scope: 'Write editor and composing toolbar. Type a name, then Enter adds a sibling.',
  },
  addSubsection: {
    label: 'Add subsection',
    keys: 'Control+Enter Meta+Enter',
    group: 'Writing',
    scope: 'Section-name form, inside an existing section.',
  },
  workflow: {
    label: 'Open workflow steps',
    keys: 'Alt+W',
    group: 'Writing',
    scope: 'Write editor and composing toolbar; built-in patterns provide step guidance.',
  },
  complete: {
    label: 'Show XML / variable suggestions',
    keys: 'Control+Space',
    group: 'Writing',
    scope: 'Prompt markdown editor, at a completable XML tag or declared variable.',
  },
  accept: {
    label: 'Accept suggestion',
    keys: 'Tab Enter',
    group: 'Writing',
    scope: 'While suggestions are visible; arrow keys choose an item, Escape dismisses.',
  },
  indent: {
    label: 'Indent instructions',
    keys: 'Tab',
    group: 'Writing',
    scope: 'Prompt markdown editor with suggestions closed. Indent selected lines or insert two spaces.',
  },
  outdent: {
    label: 'Outdent instructions',
    keys: 'Shift+Tab',
    group: 'Writing',
    scope: 'Prompt markdown editor. Remove up to two leading spaces or one tab from selected lines.',
  },
  leaveEditor: {
    label: 'Prepare to leave editor',
    keys: 'Escape',
    group: 'Writing',
    scope: 'Prompt markdown editor. Press Tab next to move focus out; Escape also dismisses suggestions.',
  },
  apply: {
    label: 'Apply writing changes',
    keys: 'Control+S Meta+S',
    group: 'Writing',
    scope: 'Write workspace; a stale draft must be resolved first. Ctrl/Cmd+Enter also applies in the writer.',
  },
  usePattern: {
    label: 'Use selected pattern',
    keys: 'Control+Enter Meta+Enter',
    group: 'Design and adoption',
    scope: 'Workflow pattern selector; arrow keys preview choices.',
  },
  saveDesign: {
    label: 'Save design',
    keys: 'Control+S Meta+S',
    group: 'Design and adoption',
    scope: 'Design workspace; valid inputs required.',
  },
  saveAdoption: {
    label: 'Save adapted prompt',
    keys: 'Control+Enter Meta+Enter',
    group: 'Design and adoption',
    scope: 'Adapt document review; resolve required fields first.',
  },
  runSingle: {
    label: 'Run prompt',
    keys: 'Control+Enter Meta+Enter',
    group: 'Runs and evaluations',
    scope: 'Single run; connect a provider and complete required inputs.',
  },
  runTests: {
    label: 'Run evaluation tests',
    keys: 'Control+Enter Meta+Enter',
    group: 'Runs and evaluations',
    scope: 'Active test suite in Run or the bottom evaluation panel; valid saved setup required.',
  },
  runComparison: {
    label: 'Run comparison',
    keys: 'Control+Enter Meta+Enter',
    group: 'Runs and evaluations',
    scope: 'Compare tab; select prompt versions, test suite and valid model settings.',
  },
  close: {
    label: 'Close current overlay',
    keys: 'Escape',
    group: 'Navigation',
    scope: 'Current dialog, menu or covering panel; unsaved changes may require confirmation.',
  },
} as const;

export type ShortcutId = keyof typeof SHORTCUTS;
export const SHORTCUT_IDS = Object.keys(SHORTCUTS) as ShortcutId[];

export function shortcutKeys(id: ShortcutId, mac: boolean): string[][] {
  const choices = SHORTCUTS[id].keys.split(' ');
  const platform = choices.filter((keys) => !keys.includes(mac ? 'Control+' : 'Meta+'));
  return (platform.length ? platform : choices).map((keys) =>
    keys.split('+').map((key) => {
      if (key === 'Meta') return '⌘';
      if (key === 'Control') return 'Ctrl';
      if (key === 'Alt') return mac ? '⌥' : 'Alt';
      if (key === 'ArrowUp') return '↑';
      if (key === 'ArrowDown') return '↓';
      return key;
    }),
  );
}

export function matchesShortcut(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  id: ShortcutId,
) {
  const key = (event.code || event.key).replace(/^(?:Key|Digit)/, '').toLowerCase();
  return SHORTCUTS[id].keys.split(' ').some((chord) => {
    const parts = chord.split('+');
    return (
      parts.at(-1)?.toLowerCase() === key &&
      event.ctrlKey === parts.includes('Control') &&
      event.metaKey === parts.includes('Meta') &&
      event.altKey === parts.includes('Alt') &&
      event.shiftKey === parts.includes('Shift')
    );
  });
}
