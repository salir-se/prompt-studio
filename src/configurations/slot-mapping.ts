import type { BaselineContent } from '../catalog/baseline-content-source';
import { providerKeyFor } from '../vcs/provider-keys';

/**
 * Sales-mode slot → studio document mapping (ADR-235).
 *
 * A `SalesModeReferenceApproach` carries prompt text for eight slots; the studio's documents are
 * catalog roots (and, for the critic, a variant-qualified provider key). This table is the ONE
 * place that translation lives — template application, configuration reset, and the tests all
 * derive their document keys from it, so a slot can never map two ways.
 *
 * Slots a baseline does not carry are simply absent from a template's document map: those
 * documents inherit the shipped default (the whole configuration model is "changes on top of
 * the shipped set").
 */

/** Slot names as they appear in `SalesModePromptBundle` / the baselines projection. */
export const SALES_MODE_SLOT_TO_DOCUMENT: Readonly<Record<string, string>> = {
  icp: 'icp',
  persona: 'persona',
  scout: 'scout',
  researcher: 'researcher',
  criticInbound: 'critic-inbound',
  closer: 'closer',
  // The reference approaches' critic slot is the compiled DEFAULT critic prompt — the first
  // variant, not the resolver root itself (see root-inventory's variants for that root).
  critic: providerKeyFor('critic-outbound-agent-loop', 'CRITIC_PROMPT'),
  discoveryProtocol: 'discovery_protocol',
};

/** Projects a baseline's slot texts onto studio document keys, dropping slots with no mapping. */
export function documentKeysForBaseline(baseline: BaselineContent): ReadonlyMap<string, string> {
  const documents = new Map<string, string>();
  for (const [slot, text] of Object.entries(baseline.prompts)) {
    const documentKey = SALES_MODE_SLOT_TO_DOCUMENT[slot];
    if (documentKey !== undefined && text.length > 0) {
      documents.set(documentKey, text);
    }
  }
  return documents;
}
