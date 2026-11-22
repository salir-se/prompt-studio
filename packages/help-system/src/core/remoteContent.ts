/**
 * Remote (CMS-managed) help content — payload validation + merge (ADR-095).
 *
 * `GET /api/help/content/:surface` serves the platform-authored, PUBLISHED
 * FAQ items. This module turns that payload into the host's `HelpContent`:
 *
 *   - `parseRemoteHelpPayload` — tolerant arktype validation: unknown extra
 *     fields are ignored (the endpoint is expand-only), any shape violation
 *     rejects the WHOLE payload (null) so a half-broken response can never
 *     splice partial content into the panel.
 *   - `mergeHelpContent` — merge by FAQ id, remote wins, additive:
 *       • a remote item with a bundled id overrides the CMS-MANAGED fields
 *         (question/answer/pinned/priority) but keeps the bundled item's
 *         `videoId`/`flag`/`experiment` gating, which the CMS doesn't model;
 *       • remote-only items append to their page;
 *       • remote-only pages are added (pageLabel from the payload);
 *       • bundled-only items/pages, `videos`, `highlightables`, and
 *         `aiContext` pass through untouched.
 *
 * The caller (useRemoteHelpContent) falls back to the bundled content on ANY
 * fetch/validation failure — the CMS can only ever add or refine, never break.
 */

import { type } from 'arktype';
import type { FaqItem, HelpContent, HelpPageContent } from './types';

const RemoteFaqItem = type({
  id: 'string',
  question: 'string',
  answer: 'string',
  'pinned?': 'boolean',
  'priority?': 'number',
  /** Monotonic CMS edit version — keys the translation cache (ADR-089 G10). */
  'version?': 'number',
});

const RemotePage = type({
  pageLabel: 'string',
  faq: RemoteFaqItem.array(),
});

const RemoteHelpPayloadSchema = type({
  surface: 'string',
  'generatedAt?': 'string',
  pages: { '[string]': RemotePage },
});

export type RemoteHelpPayload = typeof RemoteHelpPayloadSchema.infer;

/** Validate an untrusted payload. Returns null (never throws) on any shape
 *  violation — the caller keeps the bundled content. */
export function parseRemoteHelpPayload(input: unknown): RemoteHelpPayload | null {
  const parsed = RemoteHelpPayloadSchema(input);
  return parsed instanceof type.errors ? null : parsed;
}

type RemoteFaq = RemoteHelpPayload['pages'][string]['faq'][number];

/** A bundled item overridden by the CMS keeps its unmanaged fields (videoId,
 *  flag, experiment); a remote-only item is built fresh. */
function applyRemoteItem(base: FaqItem | undefined, remote: RemoteFaq): FaqItem {
  return {
    ...base,
    id: remote.id,
    question: remote.question,
    answer: remote.answer,
    pinned: remote.pinned ?? base?.pinned,
    priority: remote.priority ?? base?.priority,
    meta: remote.version === undefined ? base?.meta : { ...base?.meta, version: remote.version },
  };
}

function mergePage(base: HelpPageContent | undefined, pageLabel: string, remoteFaq: RemoteFaq[]): HelpPageContent {
  const baseFaq = base?.faq ?? [];
  const remoteById = new Map(remoteFaq.map((item) => [item.id, item]));
  const merged: FaqItem[] = baseFaq.map((item) => {
    const remote = remoteById.get(item.id);
    if (!remote) return item;
    remoteById.delete(item.id);
    return applyRemoteItem(item, remote);
  });
  for (const remote of remoteById.values()) merged.push(applyRemoteItem(undefined, remote));
  return base ? { ...base, faq: merged } : { pageLabel, faq: merged };
}

/** Merge CMS content into the bundled registry. Pure — neither input is
 *  mutated; pages untouched by the payload are returned by reference. */
export function mergeHelpContent(base: HelpContent, remote: RemoteHelpPayload): HelpContent {
  const pages: Record<string, HelpPageContent> = { ...base.pages };
  for (const [pageKey, remotePage] of Object.entries(remote.pages)) {
    if (remotePage.faq.length === 0 && !pages[pageKey]) continue;
    pages[pageKey] = mergePage(base.pages[pageKey], remotePage.pageLabel, remotePage.faq);
  }
  return { ...base, pages };
}
