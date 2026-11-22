/**
 * The closed test-kind set, declared for Vitest's `strictTags`.
 *
 * Every test file carries exactly one `// @module-tag <kind>` pragma (the
 * native per-file tag Vitest parses from the source docblock); this module
 * declares the legal kinds so a typo fails the run instead of silently
 * filtering nothing. `scripts/ci/check-test-tags.ts` enforces the same set
 * plus the node/dom partition consistency in `bun run lint`.
 *
 * Shared by `vitest.monorepo.ts` and every workspace test config (all
 * workspaces live exactly two levels below the repo root, so the import path
 * is uniform).
 */
export const TEST_KIND_TAGS = ['pure', 'dom', 'integration', 'contract', 'db', 'browser'].map((name) => ({ name }));
