import { QuickSearch } from '@prompt-studio/ui/quick-search';
import Fuse from 'fuse.js';
import { useId, useMemo, useState } from 'react';
import { selectTopFaq } from '../core/selectTopFaq';
import type { FaqItem, VideoRegistry } from '../core/types';
import { FaqVideoPreview } from './FaqVideoPreview';

export interface FaqAccordionProps {
  /** The page's authored FAQ list (gating + ranking handled by {@link selectTopFaq}). */
  items: FaqItem[];
  /** Page/tab key this accordion belongs to (namespaces panel ids; aids analytics). */
  pageKey: string;
  /** Max items in the curated default view (default 5). */
  limit?: number;
  /** Whether a boolean feature flag is enabled (resolved by the host). */
  featureFlag?: (key: string) => boolean;
  /** The active A/B variant for an experiment key (resolved by the host). */
  getVariant?: (key: string) => string | undefined;
  /** Optional "most-asked" popularity signal keyed by FAQ id — higher = earlier. */
  popularity?: Record<string, number>;
  /** Fired with the FAQ id when an item is expanded (analytics hook). */
  onOpenItem?: (faqId: string) => void;
  /** The host's video registry — resolves an item's `videoId` to its YouTube id for the preview thumbnail. */
  videos?: VideoRegistry;
  /** Fired with the (registry) video id when the user plays an item's video preview. */
  onWatchVideo?: (videoId: string) => void;
}

/**
 * Per-page FAQ accordion (ADR-089). Read-only: it only displays content.
 *
 * Default view shows a curated top-N (via {@link selectTopFaq}, which handles
 * flag/experiment gating + ranking). A search box runs Fuse.js over the full
 * gate-passing list (not capped at N); a "Browse all" toggle reveals that full
 * list when not searching. Self-contained accessible accordion — each item is a
 * header `<button aria-expanded aria-controls>` followed by a named `<section>`
 * panel (implicit `region` role), with the shared quick search control.
 */
export function FaqAccordion({
  items,
  pageKey,
  limit = 5,
  featureFlag,
  getVariant,
  popularity,
  videos,
  onOpenItem,
  onWatchVideo,
}: FaqAccordionProps) {
  const baseId = `help-faq-${useId().replace(/:/g, '')}`;
  const [query, setQuery] = useState('');
  const [browseAll, setBrowseAll] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  // The curated top-N shown by default (gated + ranked).
  const topN = useMemo(
    () => selectTopFaq(items, { limit, popularity, featureFlag, getVariant }),
    [items, limit, popularity, featureFlag, getVariant],
  );

  // The full gate-passing list (same gates, no cap) — backs search + "Browse all".
  const allGated = useMemo(
    () => selectTopFaq(items, { limit: Number.POSITIVE_INFINITY, popularity, featureFlag, getVariant }),
    [items, popularity, featureFlag, getVariant],
  );

  const fuse = useMemo(
    () => new Fuse(allGated, { keys: ['question', 'answer'], threshold: 0.4, ignoreLocation: true }),
    [allGated],
  );

  const trimmed = query.trim();
  const searching = trimmed.length > 0;

  const visible = useMemo(() => {
    if (searching) return fuse.search(trimmed).map((r) => r.item);
    return browseAll ? allGated : topN;
  }, [searching, fuse, trimmed, browseAll, allGated, topN]);

  const toggle = (item: FaqItem) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
        onOpenItem?.(item.id);
      }
      return next;
    });
  };

  return (
    <section
      data-help-faq
      data-help-page={pageKey}
      style={{ font: '14px/1.5 system-ui, sans-serif', color: 'var(--foreground, #18181b)' }}
    >
      <QuickSearch
        type="search"
        aria-label="Search help"
        value={query}
        onValueChange={setQuery}
        placeholder="Search help…"
        className="mb-3"
      />

      {visible.length === 0 ? (
        <p data-help-faq-empty style={{ margin: '8px 0', color: 'var(--muted-foreground, #71717a)' }}>
          No matching help found.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {visible.map((item) => {
            const panelId = `${baseId}-panel-${item.id}`;
            const headerId = `${baseId}-header-${item.id}`;
            const isOpen = open.has(item.id);
            const videoEntry = item.videoId ? videos?.[item.videoId] : undefined;
            return (
              <li
                key={item.id}
                style={{
                  border: '1px solid var(--border, #e4e4e7)',
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  id={headerId}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(item)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    width: '100%',
                    padding: '10px 12px',
                    border: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    font: '600 14px/1.4 system-ui, sans-serif',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span>{item.question}</span>
                  <span aria-hidden="true" style={{ flexShrink: 0, opacity: 0.6 }}>
                    {isOpen ? '−' : '+'}
                  </span>
                </button>
                {/* A named <section> has the implicit `region` role — the accessible panel
                    `aria-controls` points at, labelled by its header. */}
                <section
                  id={panelId}
                  aria-labelledby={headerId}
                  hidden={!isOpen}
                  style={{ padding: isOpen ? '0 12px 12px' : 0 }}
                >
                  <p style={{ margin: 0 }}>{item.answer}</p>
                  {videoEntry?.youtubeId ? (
                    <FaqVideoPreview
                      youtubeId={videoEntry.youtubeId}
                      title={videoEntry.title}
                      onPlay={() => {
                        if (item.videoId) onWatchVideo?.(item.videoId);
                      }}
                    />
                  ) : null}
                </section>
              </li>
            );
          })}
        </ul>
      )}

      {!searching && allGated.length > topN.length ? (
        <button
          type="button"
          onClick={() => setBrowseAll((v) => !v)}
          aria-expanded={browseAll}
          style={{
            marginTop: 12,
            padding: '6px 0',
            border: 'none',
            background: 'transparent',
            color: 'var(--primary, #2563eb)',
            font: '600 13px/1.2 system-ui, sans-serif',
            cursor: 'pointer',
          }}
        >
          {browseAll ? 'Show fewer' : `Browse all (${allGated.length})`}
        </button>
      ) : null}
    </section>
  );
}
