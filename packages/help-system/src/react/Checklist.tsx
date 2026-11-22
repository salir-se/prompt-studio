import type { ChecklistItem, ChecklistProgress } from '../core/checklist';

/**
 * Onboarding checklist surface (ADR-089 §8a G8). Presentational + theme-free:
 * renders a {@link ChecklistProgress} as ☑/☐ items with a progress count and a
 * "Start" affordance for incomplete items that have a page/tour to jump to.
 *
 * READ-ONLY: it never marks items done itself (completion comes from the milestone
 * stream via `checklistProgress`); "Start" only navigates / launches a tour.
 */
export interface ChecklistProps {
  progress: ChecklistProgress;
  /** Invoked when the user clicks "Start" on an incomplete item (host navigates / starts the tour). */
  onStartItem?: (item: ChecklistItem) => void;
}

export function Checklist({ progress, onStartItem }: ChecklistProps) {
  return (
    <section data-help-checklist={progress.id} aria-label={progress.title}>
      <header>
        <h3>{progress.title}</h3>
        <p data-checklist-progress>
          {progress.doneCount} of {progress.total} done
        </p>
      </header>
      <ul>
        {progress.items.map(({ item, done }) => (
          <li key={item.id} data-checklist-item={item.id} data-done={done}>
            <span aria-hidden="true">{done ? '☑' : '☐'}</span>
            <span>{item.label}</span>
            {!done && (item.pageKey || item.tourId) ? (
              <button type="button" onClick={() => onStartItem?.(item)}>
                Start
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
