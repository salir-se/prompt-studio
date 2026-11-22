import { useState } from 'react';
import {
  type DefinitionImport,
  type DefinitionKind,
  exportDefinitions,
  mergeDefinitionImport,
  readDefinitionImport,
} from './definition-transfer';
import {
  type ProjectDefinitions,
  type ProjectTool,
  type ProjectVariable,
  validateProjectDefinitions,
} from './project-definitions';

export type DefinitionEditor = {
  originalName?: string;
  name: string;
  description: string;
  sample: string;
  required: boolean;
  lifecycle: ProjectVariable['lifecycle'];
  encoding: ProjectVariable['encoding'];
  presentation: ProjectVariable['presentation'];
  schema: string;
};
const blank: DefinitionEditor = {
  name: '',
  description: '',
  sample: '',
  required: true,
  lifecycle: 'runtime',
  encoding: 'xml-text',
  presentation: 'placeholder',
  schema: '{\n  "type": "object",\n  "properties": {},\n  "additionalProperties": false\n}',
};

export function useDefinitionsEditor({
  definitions,
  onSave,
  kind,
}: {
  definitions: ProjectDefinitions;
  onSave: (next: ProjectDefinitions) => Promise<void>;
  kind: DefinitionKind;
}) {
  const [editor, setEditor] = useState<DefinitionEditor | null>(null);
  const [initialEditor, setInitialEditor] = useState<DefinitionEditor | null>(null);
  const [imported, setImported] = useState<DefinitionImport | null>(null);
  const [conflictChoice, setConflictChoice] = useState<'keep' | 'replace' | ''>('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const conflicts =
    imported?.[kind]
      .filter((entry) => definitions[kind].some((current) => current.name === entry.name))
      .map((entry) => entry.name) ?? [];

  const dirty = editor !== null && JSON.stringify(editor) !== JSON.stringify(initialEditor);
  function confirmReplaceEditor(): boolean {
    return !dirty || window.confirm('Discard unsaved changes in this panel? Choose Cancel to keep editing.');
  }

  async function save(next: () => ProjectDefinitions, done: () => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await onSave(validateProjectDefinitions(next()));
      done();
      setNotice('Saved to this project.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save. Your changes are still here; try again.');
    } finally {
      setBusy(false);
    }
  }
  function edit(entry: ProjectVariable | ProjectTool) {
    if (!confirmReplaceEditor()) return;
    setError(null);
    setNotice(null);
    setImported(null);
    setPendingDelete(null);
    const next =
      'purpose' in entry
        ? { ...blank, ...entry, description: entry.purpose, originalName: entry.name }
        : {
            ...blank,
            name: entry.name,
            description: entry.description,
            schema: JSON.stringify(entry.inputSchema, null, 2),
            originalName: entry.name,
          };
    setEditor(next);
    setInitialEditor(next);
  }
  function saveEditor() {
    if (!editor) return;
    return save(
      () => {
        const entry: ProjectVariable | ProjectTool =
          kind === 'variables'
            ? {
                name: editor.name.trim(),
                purpose: editor.description.trim(),
                sample: editor.sample,
                required: editor.required,
                lifecycle: editor.lifecycle,
                encoding: editor.encoding,
                presentation: editor.presentation,
              }
            : {
                name: editor.name.trim(),
                description: editor.description.trim(),
                inputSchema: JSON.parse(editor.schema),
              };
        const remaining = definitions[kind].filter((item) => item.name !== editor.originalName);
        return { ...definitions, [kind]: [...remaining, entry] };
      },
      () => setEditor(null),
    );
  }
  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (file.size > 2_000_000) throw new Error('Choose a JSON file smaller than 2 MB.');
      const parsed = readDefinitionImport(await file.text(), kind, definitions);
      if (!confirmReplaceEditor()) return;
      setImported(parsed);
      setConflictChoice('');
      setEditor(null);
      setPendingDelete(null);
    } catch (failure) {
      setImported(null);
      setError(
        failure instanceof SyntaxError
          ? `This file is not valid JSON. Choose a ${kind} JSON export and try again.`
          : failure instanceof Error
            ? failure.message
            : 'Could not read that JSON file.',
      );
    } finally {
      setBusy(false);
    }
  }
  function download() {
    setError(null);
    try {
      const url = URL.createObjectURL(new Blob([exportDefinitions(definitions, kind)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${kind}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not export these definitions.');
    }
  }
  function startNew(tool?: ProjectTool) {
    if (!confirmReplaceEditor()) return false;
    setEditor(
      tool
        ? {
            ...blank,
            name: tool.name,
            description: tool.description,
            schema: JSON.stringify(tool.inputSchema, null, 2),
          }
        : { ...blank },
    );
    setInitialEditor({ ...blank });
    setImported(null);
    setPendingDelete(null);
    setError(null);
    setNotice(null);
    return true;
  }
  return {
    editor,
    dirty,
    setEditor,
    imported,
    setImported,
    conflictChoice,
    setConflictChoice,
    pendingDelete,
    setPendingDelete,
    busy,
    error,
    notice,
    conflicts,
    edit,
    saveEditor,
    upload,
    download,
    create: () => startNew(),
    createFromTool: (tool: ProjectTool) => startNew(tool),
    applyImport: () =>
      imported &&
      save(
        () => mergeDefinitionImport(definitions, imported, kind, conflictChoice === 'replace'),
        () => setImported(null),
      ),
    remove: (name: string) =>
      save(
        () => ({ ...definitions, [kind]: definitions[kind].filter((entry) => entry.name !== name) }),
        () => setPendingDelete(null),
      ),
  };
}
