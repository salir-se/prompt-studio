import type { ReactNode } from 'react';
import {
  resolveResourceCenterSections,
  type ResourceCenterConfig,
  type ResourceCenterSectionType,
} from '../core/resourceCenter';

/**
 * Resource-center "Help Home" (ADR-089 §8a G1). Composition layout: renders the
 * host-ordered, flag-gated sections, filling each with a host-supplied slot. The
 * package owns ordering/gating; the host owns each section's content (search box,
 * popular FAQ, ask-AI button, …) so the home stays universal + theme-free.
 *
 * Renders `null` when the home is disabled or no provided slot is visible — the
 * panel then falls back to its default FAQ+Chat view.
 */
export interface ResourceCenterProps {
  config: ResourceCenterConfig;
  flagEnabled?: (flag: string) => boolean;
  /** Content for each section type; a section with no slot is skipped. */
  slots: Partial<Record<ResourceCenterSectionType, ReactNode>>;
}

export function ResourceCenter({ config, flagEnabled, slots }: ResourceCenterProps) {
  const visible = resolveResourceCenterSections(config, { flagEnabled }).filter((type) => slots[type] != null);
  if (visible.length === 0) return null;
  return (
    <section data-help-home aria-label="Help home">
      {visible.map((type) => (
        <section key={type} data-section={type}>
          {slots[type]}
        </section>
      ))}
    </section>
  );
}
