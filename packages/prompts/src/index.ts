// ── @prompt-studio/prompts ─────────────────────────────────────────────────────
// Prompt engine used by Prompt Studio: prompt trees, designs, placeholders, verification profiles,
// and blueprint serialization. It ships no built-in prompts (see ./builtin-catalog).

export const PROMPT_VERSION = '2026-11-22-v1' as const;

export * from './blueprint-renderer';
export * from './builtin-catalog';
export * from './canonical-json';
export * from './composition-contracts';
export * from './engine';
export * from './extension-contracts';
export * from './prompt-design';
export * from './prompt-design-sections';
export * from './prompt-file-references';
export * from './prompt-source-literals';
export * from './root-inventory-contract';
export * from './rubric-declaration';
export * from './structure-contracts';
export * from './structured-output';
export * from './tree/attribute-findings';
export * from './tree/edit-tree';
export * from './tree/graph-model';
export * from './tree/parse-tree';
export * from './tree/project-canonical-tree';
export * from './tree/serialize-blueprint';
export * from './tree/types';
export * from './types';
export * from './variable-assist';
export * from './variable-docs';
export * from './verification-contracts';
export * from './verification-profiles';
