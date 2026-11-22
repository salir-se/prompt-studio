// Announcements / "What's new" (ADR-089 §8a G15). Pure + framework-agnostic.
//
// Proactive, gate-able, date-bounded notices surfaced in the resource-center home
// (G1). Authored English; selection is page-scoped, flag-gated, and time-windowed.

export interface Announcement {
  id: string;
  title: string;
  body: string;
  /** Restrict to these page keys; absent ⇒ shown on every page. */
  pageKeys?: string[];
  /** Boolean feature-flag gate; absent ⇒ ungated. */
  flag?: string;
  /** ISO timestamp the announcement starts showing; absent ⇒ already started. */
  startsAt?: string;
  /** ISO timestamp the announcement stops showing; absent ⇒ never ends. */
  endsAt?: string;
}

export interface SelectAnnouncementsOptions {
  /** Current page key (for `pageKeys` scoping). */
  pageKey?: string;
  /** Clock for the date window; defaults to now. */
  now?: Date;
  /** Resolve a boolean feature flag (for `flag` gating); absent ⇒ flagged items hidden. */
  flagEnabled?: (flag: string) => boolean;
}

/** Whether an announcement is within its [startsAt, endsAt] window at `now`. */
function inWindow(announcement: Announcement, now: Date): boolean {
  const t = now.getTime();
  if (announcement.startsAt && new Date(announcement.startsAt).getTime() > t) return false;
  if (announcement.endsAt && new Date(announcement.endsAt).getTime() <= t) return false;
  return true;
}

/**
 * Filter announcements to those visible right now: within the date window,
 * matching the current page (or page-agnostic), and passing the flag gate.
 * Order is preserved (author order).
 */
export function selectAnnouncements(
  announcements: Announcement[],
  options: SelectAnnouncementsOptions = {},
): Announcement[] {
  const { pageKey, now = new Date(), flagEnabled } = options;
  return announcements.filter((a) => {
    if (a.flag && !(flagEnabled?.(a.flag) ?? false)) return false;
    if (a.pageKeys && pageKey !== undefined && !a.pageKeys.includes(pageKey)) return false;
    if (a.pageKeys && pageKey === undefined) return false;
    return inWindow(a, now);
  });
}
