/**
 * The Milkdown Crepe WYSIWYG — the ONLY module in the monorepo that imports
 * `@milkdown/*` (ADR-096). It is loaded exclusively through `MarkdownEditor`'s
 * `lazy()` so prosemirror + the Crepe theme CSS stay in their own chunk and
 * never ride into an app's initial bundle. Import `MarkdownEditor`, not this.
 *
 * Contract: `defaultValue` is the INITIAL document — Crepe owns the document
 * state afterwards and reports every edit through `onChange(markdown)`. To
 * load a different document, remount with a new React `key` (see
 * `MarkdownEditor`'s `contentKey` prop).
 */

import { Crepe } from '@milkdown/crepe';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { useEffect, useRef } from 'react';
import { configureExactMarkdown, editorMarkdownParser } from './exact-markdown';
import {
  type Fidelity,
  measureFidelity,
  type ParseMarkdown,
  removeRedundantEscapes,
  type RequiredFidelity,
  visualKeepsText,
} from './markdown-fidelity';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
// Salir overrides LAST so they win the cascade: shadcn light/dark tokens +
// compact mobile-first metrics instead of Crepe's white document-page theme.
import './salir-theme.css';

/**
 * Keep the author's text. On load the editor measures what it would write back for `defaultValue`; below `required`
 * it calls `onWouldChange` (the host opens Raw). Every write removes escapes the parser never needed, and nothing is
 * written back until the document differs from what the editor loaded, so opening a field never rewrites it.
 */
export interface KeepText {
  required: RequiredFidelity;
  onWouldChange: (measured: Exclude<Fidelity, 'exact'>) => void;
}

export interface MilkdownCrepeEditorProps {
  defaultValue: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  /** Absent = the editor writes back what the serializer produces, as before. */
  keepText?: KeepText;
}

function CrepeEditorInner({ defaultValue, onChange, placeholder, readOnly, keepText }: MilkdownCrepeEditorProps) {
  // Latest-callback ref: the Crepe factory runs once (deps []), but the host
  // may re-render with a new closure — edits must always reach the live one.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const crepeRef = useRef<Crepe | null>(null);
  // Read once, like `defaultValue`: the factory below runs once per mount (the host remounts for a new document).
  const keepTextRef = useRef(keepText);

  useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue,
      // Minimalistic surface (the requirement): no image upload, no LaTeX,
      // no tables, no AI — the help-system Markdown renderer and the email
      // pipeline support none of them, so offering the buttons would author
      // content that renders broken downstream.
      features: {
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.Table]: false,
      },
      featureConfigs: placeholder ? { [Crepe.Feature.Placeholder]: { text: placeholder, mode: 'doc' } } : undefined,
    });
    const keep = keepTextRef.current;
    if (!keep) {
      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, markdown) => onChangeRef.current(markdown));
      });
    } else {
      crepe.editor.config(configureExactMarkdown);
      let parse: ParseMarkdown | null = null;
      // What the editor writes for the document as loaded; a write equal to it is not an edit.
      let loaded: string | null = null;
      crepe.on((listener) => {
        listener.mounted((ctx) => {
          parse = editorMarkdownParser(ctx);
          loaded = removeRedundantEscapes(crepe.getMarkdown(), parse);
          const measured = measureFidelity(defaultValue, loaded, parse);
          if (measured !== 'exact' && !visualKeepsText(measured, keep.required)) keep.onWouldChange(measured);
        });
        listener.markdownUpdated((_ctx, markdown) => {
          if (!parse) return;
          const written = removeRedundantEscapes(markdown, parse);
          if (written !== loaded) onChangeRef.current(written);
        });
      });
    }
    crepe.setReadonly(readOnly ?? false);
    crepeRef.current = crepe;
    return crepe;
  }, []);

  useEffect(() => {
    crepeRef.current?.setReadonly(readOnly ?? false);
  }, [readOnly]);

  return <Milkdown />;
}

/** Default export so `lazy(() => import('./MilkdownCrepeEditor'))` needs no
 *  `.then` adapter. */
export default function MilkdownCrepeEditor(props: MilkdownCrepeEditorProps) {
  return (
    <MilkdownProvider>
      <CrepeEditorInner {...props} />
    </MilkdownProvider>
  );
}
