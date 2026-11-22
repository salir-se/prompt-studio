// CMS `cms:assistant` KV overlay contract (ADR-095).
//
// The help CMS (the `helper` worker — historically the auth worker) WRITES a
// SEPARATE `cms:assistant` key into the inference worker's INFERENCE_PROMPTS KV
// namespace, layered on top of the seeder-owned `bundle:assistant` record. The
// inference worker READS it at prompt-assembly time. Both sides bind the same
// namespace ids (ADR-097 shared-KV rule); this module is the ONE canonical
// definition of the key + record shape so the writer and the reader can never
// drift (previously each worker carried a near-duplicate local copy).
//
// Key-prefix ownership contract (documented in both wrangler.toml files):
//   `bundle:*` = scripts/seed-prompts.ts (seeder)   — the always-safe fallback
//   `cms:*`    = the helper worker (single writer)   — the editable overlay

/** KV key the help CMS writes and the inference worker reads. */
export const CMS_ASSISTANT_KEY = 'cms:assistant';

/**
 * The `cms:assistant` overlay record.
 *
 * Rebuilt in full from the two active admin-DB help documents on every save
 * (idempotent, no read-modify-write). Every field is OPTIONAL at read time: a
 * missing key, malformed JSON, or empty field falls back to the seeded bundle
 * (the assistant must never break on CMS state).
 */
export interface CmsAssistantOverlay {
  /** Overlay schema version. `'1'` today; the reader tolerates unknown values
   *  and validates fields individually so additions stay backward-compatible. */
  version: string;
  /** Replaces `bundle.operatorGuide` when present and non-empty. */
  operatorGuide?: string;
  /** Appended post-assembly in a `<platform_help_instructions>` section. */
  assistantInstructions?: string;
  /** ISO timestamp of the last rebuild. Informational; not read by assembly. */
  updatedAt?: string;
}
