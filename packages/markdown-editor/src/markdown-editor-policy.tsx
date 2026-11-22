/**
 * App-wide editor policy. The package never reads feature flags (they are evaluated at the app boundary): an app
 * resolves its flags once and passes the decisions in through this provider, so every `MarkdownEditor` under it
 * follows them without a prop at each call site.
 */
import { createContext, type ReactNode, useContext } from 'react';

export interface MarkdownEditorPolicy {
  /**
   * Keep the author's text (`app.markdown-editor.keep-author-text`): the Visual view removes escapes the parser
   * never needed, writes nothing back until the author edits, and a text it would change opens in Raw instead.
   * Off = the editor behaves as before.
   */
  keepAuthorText: boolean;
  /**
   * Visual prose (`app.markdown-editor.visual-prose`): fields declared `mode="prose"` open in the Visual editor.
   * Off = they stay the plain text box they were. Prompts, templates and data-entry fields never declare `prose`.
   */
  visualProse: boolean;
}

const DEFAULT_POLICY: MarkdownEditorPolicy = { keepAuthorText: false, visualProse: false };

const MarkdownEditorPolicyContext = createContext<MarkdownEditorPolicy>(DEFAULT_POLICY);

export function MarkdownEditorPolicyProvider({
  value,
  children,
}: {
  value: MarkdownEditorPolicy;
  children: ReactNode;
}): React.JSX.Element {
  return <MarkdownEditorPolicyContext value={value}>{children}</MarkdownEditorPolicyContext>;
}

export function useMarkdownEditorPolicy(): MarkdownEditorPolicy {
  return useContext(MarkdownEditorPolicyContext);
}
