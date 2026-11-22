import type { ContentMeta, HelpContent } from './types';

// Content governance (ADR-089 §8a G9). Pure + framework-agnostic.
//
// Only `published`, non-expired content renders; everything else (draft / in
// review / archived / past `expiresAt`) is hidden from users and surfaced in an
// author review queue via `staleContent`. Absent `meta` ⇒ published (so existing
// content without governance metadata keeps working — back-compatible).

/** Why a content node is held back from users (drives the author review queue). */
export type StaleReason = 'expired' | 'in_review' | 'draft' | 'archived';

/** One entry in the author "needs attention" queue. */
export interface StaleContentEntry {
  kind: 'page' | 'faq' | 'video';
  /** Page key for `faq`/`page` entries; the FAQ/page they belong to. */
  pageKey?: string;
  /** FAQ id, video id, or page key. */
  id: string;
  reason: StaleReason;
  owner?: string;
}

/**
 * Whether a content node should render to users. `undefined` meta is published
 * by default (back-compat). A node is hidden when its status is anything other
 * than `published`, or when `expiresAt` is at/before `now`.
 */
export function isPublished(meta: ContentMeta | undefined, now: Date = new Date()): boolean {
  if (!meta) return true;
  if (meta.status && meta.status !== 'published') return false;
  if (meta.expiresAt && new Date(meta.expiresAt).getTime() <= now.getTime()) return false;
  return true;
}

/** Map a hidden node's `meta` to the reason it's held back (expiry wins over status). */
function staleReason(meta: ContentMeta, now: Date): StaleReason | null {
  if (meta.expiresAt && new Date(meta.expiresAt).getTime() <= now.getTime()) return 'expired';
  if (meta.status === 'review') return 'in_review';
  if (meta.status === 'draft') return 'draft';
  if (meta.status === 'archived') return 'archived';
  return null;
}

/**
 * Scan a content registry for nodes that are NOT live (expired or non-published)
 * so an authoring surface can list what needs attention. Order: pages, then each
 * page's FAQ, then videos — stable for deterministic rendering/tests.
 */
export function staleContent(content: HelpContent, now: Date = new Date()): StaleContentEntry[] {
  const out: StaleContentEntry[] = [];
  for (const [pageKey, page] of Object.entries(content.pages)) {
    const pageReason = page.meta && staleReason(page.meta, now);
    if (pageReason) out.push({ kind: 'page', id: pageKey, reason: pageReason, owner: page.meta?.owner });
    for (const item of page.faq) {
      const reason = item.meta && staleReason(item.meta, now);
      if (reason) out.push({ kind: 'faq', pageKey, id: item.id, reason, owner: item.meta?.owner });
    }
  }
  for (const [videoId, video] of Object.entries(content.videos ?? {})) {
    const reason = video.meta && staleReason(video.meta, now);
    if (reason) out.push({ kind: 'video', id: videoId, reason, owner: video.meta?.owner });
  }
  return out;
}
