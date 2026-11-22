import type { BaselineContent } from '../catalog/baseline-content-source';
import type { HistoryProvider } from '../vcs/history-provider';
import { documentKeysForBaseline } from './slot-mapping';

/**
 * Configuration seed templates (ADR-235): a named starting point expressed as document-key →
 * text, applied to a project as ORDINARY COMMITS through the unchanged `HistoryProvider`.
 *
 * A configuration IS an ADR-203 project — `applyTemplate` is the only new mechanic, and it is
 * pure composition over `provider.commit`: one commit per document (`seed from … (<key>)`), so
 * provenance rides in commit messages, History shows exactly what the seed changed, and a reset
 * is the same function again (append-only, never destructive). The shipped-default template has
 * an EMPTY document map — creating from it commits nothing (the project already inherits the
 * shipped baseline by construction).
 */

export interface ConfigurationTemplate {
  readonly id: string;
  readonly label: string;
  readonly positioning: 'shipped' | 'reference';
  /** Document key → text; absent documents inherit the shipped default. */
  readonly documents: ReadonlyMap<string, string>;
}

/** The shipped-default template: nothing to seed — the baseline IS the shipped catalog. */
export function shippedTemplate(): ConfigurationTemplate {
  return { id: 'default', label: 'Your prompts', positioning: 'shipped', documents: new Map() };
}

/** Builds a reference template from a baseline's projected texts. */
export function templateFromBaseline(baseline: BaselineContent): ConfigurationTemplate {
  return {
    id: baseline.id,
    label: baseline.id,
    positioning: 'reference',
    documents: documentKeysForBaseline(baseline),
  };
}

export interface ApplyTemplateOptions {
  /** Override the commit-message verb; defaults to `seed` (`reset` for configuration resets). */
  readonly verb?: 'seed' | 'reset';
}

/**
 * Applies every template document as one append-only commit, SEQUENTIALLY (the git provider's
 * ops are not internally serialized yet — parallel commits can interleave; awaiting each commit
 * keeps the history order deterministic and readable). Commits only documents the template
 * spans; everything else stays at whatever the project already has.
 */
export async function applyTemplate(
  provider: HistoryProvider,
  projectId: string,
  template: ConfigurationTemplate,
  options: ApplyTemplateOptions = {},
): Promise<number> {
  const verb = options.verb ?? 'seed';
  const fromLabel = template.positioning === 'reference' ? `reference ${template.id}` : 'shipped default';
  let applied = 0;
  for (const [documentKey, text] of template.documents) {
    await provider.commit({
      projectId,
      rootKey: documentKey,
      text,
      message: `${verb} from ${fromLabel} (${documentKey})`,
    });
    applied += 1;
  }
  return applied;
}

/**
 * "Reset the configuration to its starting point": first every editable document back to its
 * SHIPPED text (the foundation every baseline builds on), then the starting template's own
 * documents on top — all as ordinary commits, so the whole operation is visible in History and
 * individually restorable. `shippedTexts` comes from the App's catalog (constants, variants,
 * and manifest fragment documents alike).
 */
export async function resetConfigurationToStart(
  provider: HistoryProvider,
  projectId: string,
  template: ConfigurationTemplate,
  shippedTexts: ReadonlyMap<string, string>,
): Promise<number> {
  let applied = 0;
  for (const [documentKey, text] of shippedTexts) {
    await provider.commit({
      projectId,
      rootKey: documentKey,
      text,
      message: `reset to shipped default (${documentKey})`,
    });
    applied += 1;
  }
  applied += await applyTemplate(provider, projectId, template, { verb: 'reset' });
  return applied;
}
