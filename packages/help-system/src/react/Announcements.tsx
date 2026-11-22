import type { Announcement } from '../core/announcements';

/**
 * "What's new" surface (ADR-089 §8a G15). Presentational + theme-free: renders the
 * already-selected ({@link selectAnnouncements}) announcements as a titled list,
 * with an optional dismiss affordance the host wires to persistence.
 */
export interface AnnouncementsProps {
  announcements: Announcement[];
  /** Invoked when the user dismisses an announcement (host persists the dismissal). */
  onDismiss?: (id: string) => void;
}

export function Announcements({ announcements, onDismiss }: AnnouncementsProps) {
  if (announcements.length === 0) return null;
  return (
    <section data-help-announcements aria-label="What's new">
      <ul>
        {announcements.map((announcement) => (
          <li key={announcement.id} data-announcement={announcement.id}>
            <h4>{announcement.title}</h4>
            <p>{announcement.body}</p>
            {onDismiss ? (
              <button
                type="button"
                aria-label={`Dismiss ${announcement.title}`}
                onClick={() => onDismiss(announcement.id)}
              >
                Dismiss
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
