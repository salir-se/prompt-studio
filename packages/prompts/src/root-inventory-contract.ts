export type LegacyPromptRootKind = 'system' | 'top-level-message';
export type LegacyPromptRuntimeStatus = 'live' | 'callable' | 'evaluation';
export type LegacyPromptSourceRef = { module: string; symbol: string };
export type LegacyPromptRootInventoryEntry = {
  id: string;
  kind: LegacyPromptRootKind;
  status: LegacyPromptRuntimeStatus;
  owner: LegacyPromptSourceRef;
  consumers: readonly LegacyPromptSourceRef[];
  editableKeys: readonly string[];
  dynamicSources: readonly LegacyPromptSourceRef[];
  toolSets: readonly LegacyPromptSourceRef[];
  variants: readonly LegacyPromptSourceRef[];
  ownedFragments: readonly LegacyPromptSourceRef[];
  protectedSkills: readonly string[];
  legacyIdentity: readonly LegacyPromptSourceRef[];
};

export const source = (module: string, symbol: string): LegacyPromptSourceRef => ({ module, symbol });
