import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { matchesShortcut } from '../shortcuts/shortcuts';
import {
  type Completion,
  completionsAt,
  type DraftEdit,
  draftSections,
  insertDraftSection,
  instructionStep,
  sectionAt,
  sectionSelection,
} from './composing';
import { indentSelection } from './indentation';
import { applyNativeEdit } from './native-edit';
import { patternSteps } from './pattern-steps';

export function useComposing(
  text: string,
  variables: readonly string[],
  workflow: string | undefined,
  onChange: (text: string) => void,
) {
  const container = useRef<HTMLFieldSetElement>(null);
  const selection = useRef({ start: 0, end: 0 });
  const composing = useRef(false);
  const tabLeavesEditor = useRef(false);
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [index, setIndex] = useState(0);
  const [insertOpen, setInsertOpen] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const sections = useMemo(() => draftSections(text), [text]);
  const guide = useMemo(() => patternSteps(workflow), [workflow]);
  const active = sectionAt(sections, caret ?? selection.current.start);
  const suggestions = useMemo(
    () =>
      caret === null || dismissed
        ? []
        : completionsAt(
            text,
            caret,
            variables,
            sections.flatMap((section) => (section.tag ? [section.tag] : [])),
          ),
    [text, caret, variables, sections, dismissed],
  );
  const selected = Math.min(index, Math.max(0, suggestions.length - 1));
  const editor = () => container.current?.querySelector('textarea') ?? null;

  useEffect(() => {
    const element = container.current?.querySelector('textarea');
    if (!element) return;
    element.setAttribute('aria-autocomplete', 'list');
    if (suggestions.length) {
      element.setAttribute('aria-controls', listId);
      element.setAttribute('aria-activedescendant', `${listId}-${selected}`);
      document.getElementById(`${listId}-${selected}`)?.scrollIntoView?.({ block: 'nearest' });
    } else {
      element.removeAttribute('aria-controls');
      element.removeAttribute('aria-activedescendant');
    }
  }, [listId, suggestions.length, selected]);

  function track() {
    const element = editor();
    if (!element || composing.current) return;
    tabLeavesEditor.current = false;
    selection.current = { start: element.selectionStart, end: element.selectionEnd };
    setCaret(element.selectionStart === element.selectionEnd ? element.selectionStart : null);
    setDismissed(false);
    setIndex(0);
  }
  function apply(edit: DraftEdit) {
    const element = editor();
    if (!element || composing.current) return;
    if (!applyNativeEdit(element, edit)) {
      setError(
        'Your browser could not insert text with Undo support. Your draft is kept; type or paste into the editor.',
      );
      return;
    }
    onChange(edit.text);
    setError(null);
    selection.current = { start: edit.selectionStart, end: edit.selectionEnd };
    setCaret(edit.selectionStart === edit.selectionEnd ? edit.selectionStart : null);
    setDismissed(true);
  }
  function accept(item: Completion) {
    apply({
      text: text.slice(0, item.from) + item.text + text.slice(item.to),
      selectionStart: item.from + item.caret,
      selectionEnd: item.from + item.caret,
    });
  }
  function jump(section: (typeof sections)[number]) {
    setJumpOpen(false);
    const edit = sectionSelection(text, section);
    apply({ ...edit, selectionEnd: edit.selectionStart });
  }
  function openJump() {
    setQuery('');
    setJumpOpen(true);
  }
  function keyDown(event: KeyboardEvent<HTMLFieldSetElement>) {
    if (event.nativeEvent.isComposing || composing.current || event.defaultPrevented) return;
    if (matchesShortcut(event, 'jump')) {
      event.preventDefault();
      openJump();
      return;
    }
    if (matchesShortcut(event, 'addSection') || matchesShortcut(event, 'workflow')) {
      event.preventDefault();
      if (matchesShortcut(event, 'addSection')) setInsertOpen(true);
      else setStepsOpen(true);
      return;
    }
    if (!(event.target instanceof HTMLTextAreaElement)) return;
    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      tabLeavesEditor.current = true;
      if (!suggestions.length) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey && tabLeavesEditor.current) {
      tabLeavesEditor.current = false;
      return;
    } else tabLeavesEditor.current = false;
    if (matchesShortcut(event, 'complete')) {
      event.preventDefault();
      track();
      return;
    }
    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      ['ArrowUp', 'ArrowDown'].includes(event.key)
    ) {
      event.preventDefault();
      const next =
        event.key === 'ArrowDown'
          ? sections.find((section) => section.range.start > selection.current.start)
          : [...sections]
              .reverse()
              .find((section) => section.range.start < (active?.range.start ?? selection.current.start));
      if (next) jump(next);
      return;
    }
    if (suggestions.length && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (!event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        setIndex((selected + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
      } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
        event.preventDefault();
        accept(suggestions[selected]);
        return;
      } else if (event.key === 'Escape' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(true);
        return;
      }
    }
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const element = event.target;
      apply(
        indentSelection(text, element.selectionStart, element.selectionEnd, event.shiftKey, element.selectionDirection),
      );
    }
  }
  return {
    container,
    editor,
    caret,
    listId,
    sections,
    active,
    suggestions,
    selected,
    jumpOpen,
    query,
    setQuery,
    openJump,
    insertOpen,
    setInsertOpen,
    stepsOpen,
    setStepsOpen,
    setJumpOpen,
    error,
    guide,
    accept,
    jump,
    keyDown,
    track,
    startComposition() {
      composing.current = true;
      setCaret(null);
    },
    endComposition() {
      composing.current = false;
      track();
    },
    blur() {
      setCaret(null);
    },
    insert(name: string, child: boolean) {
      apply(insertDraftSection(text, active, child, name));
    },
    fillStep(id: string) {
      const edit = workflow && instructionStep(text, workflow, id);
      if (edit) apply(edit);
    },
  };
}
