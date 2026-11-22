// @module-tag dom
/**
 * Declaring a session variable through the real `useVariablesRegistry` write path clears both
 * places an undeclared placeholder shows up: the status bar's undeclared names and the
 * known-placeholder verification finding. The document and the finding are real — the starter
 * project's Support Triage prompt (with its saved design) and `runRootVerification`, the same call the Verify button makes — so this
 * proves the rule without mounting the whole App (12 full-App re-renders took 3 s locally and timed
 * out at 15 s on a loaded CI runner). `App.editing.test.tsx` keeps the drawer-to-status-bar wiring.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { withPromptStructure } from '../design/prompt-design-project';
import { runRootVerification } from '../panels/root-verification';
import { STORAGE_KEY_PREFIX } from '../registry/registry-persistence';
import { supportTriageRoot } from '../test-fixtures/starter-catalog';
import type { DocumentEditor } from './use-document-editor';
import type { HistoryBoot } from './use-history-boot';
import { useVariablesRegistry } from './use-variables-registry';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function supportTriageWithUndeclaredPlaceholder() {
  const root = supportTriageRoot();
  if (!root.text?.includes('</mission>')) {
    throw new Error('Fixture setup failed: the Support Triage prompt has no <mission> section.');
  }
  // Same edit as the App harness's `editInUndeclaredPlaceholder`: append to the Mission section body.
  const text = root.text.replace('</mission>', ' {{not_declared_anywhere}}\n</mission>');
  const editor = {
    doc: { rootId: root.id, text },
    model: { nodes: [], edges: [] },
    verificationResult: runRootVerification(withPromptStructure(root, text), text),
    selectedRootId: root.id,
  } as unknown as DocumentEditor;
  return { editor, boot: { history: null } as unknown as HistoryBoot };
}

const knownPlaceholderSubjects = (result: ReturnType<typeof useVariablesRegistry>['displayedVerificationResult']) =>
  (result?.findings ?? []).flatMap((finding) =>
    'ruleId' in finding && finding.ruleId === 'known-placeholder' ? [finding.subject] : [],
  );

it('declaring a session variable removes it from the undeclared names and from the known-placeholder finding', () => {
  // Given: the Support Triage prompt with an undeclared placeholder, verified by the real verifier
  // (its own {{company_name}} and {{customer_message}} are undeclared too: no built-in variables ship)
  const { editor, boot } = supportTriageWithUndeclaredPlaceholder();
  const { result } = renderHook(() => useVariablesRegistry({ boot, editor }));
  expect(result.current.undeclaredNames).toEqual(['company_name', 'customer_message', 'not_declared_anywhere']);
  expect(knownPlaceholderSubjects(result.current.displayedVerificationResult)).toContain('not_declared_anywhere');

  // When: the author declares it through the registry's write path
  let error: ReturnType<typeof result.current.declare>;
  act(() => {
    error = result.current.declare({
      name: 'not_declared_anywhere',
      purpose: 'A placeholder declared for this test.',
      sample: '',
      required: false,
    });
  });

  // Then: it is no longer undeclared, the finding is gone, and the declaration is saved for the Support Triage root
  expect(error).toBeUndefined();
  expect(result.current.undeclaredNames).toEqual(['company_name', 'customer_message']);
  expect(knownPlaceholderSubjects(result.current.displayedVerificationResult)).not.toContain('not_declared_anywhere');
  expect(window.localStorage.getItem(`${STORAGE_KEY_PREFIX}support-triage`)).toContain('not_declared_anywhere');
});
