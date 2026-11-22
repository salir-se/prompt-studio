// Resource-center "Help Home" model (ADR-089 §8a G1). Pure + framework-agnostic.
//
// The panel opens to a browsable home composed of host-ordered, gate-able
// sections (search / popular FAQ / ask-AI / tours / videos / checklists /
// contact-support / announcements) rather than going straight to FAQ+Chat. This
// layer only resolves WHICH sections show and in what order; the React component
// fills each with host-supplied content.

export type ResourceCenterSectionType =
  'search' | 'popular' | 'ask_ai' | 'tours' | 'videos' | 'checklists' | 'contact_support' | 'announcements';

export interface ResourceCenterSection {
  type: ResourceCenterSectionType;
  /** Boolean feature-flag gate; absent ⇒ ungated. */
  flag?: string;
}

export interface ResourceCenterConfig {
  /** When `false`, the home is disabled and the panel uses its default view. */
  enabled?: boolean;
  /** Sections in the order they should render. */
  sections: ResourceCenterSection[];
}

/**
 * Resolve the ordered list of section types to render: empty when the home is
 * absent or disabled, otherwise the author-ordered sections with flag-gated ones
 * dropped unless their flag is on.
 */
export function resolveResourceCenterSections(
  config: ResourceCenterConfig | undefined,
  options: { flagEnabled?: (flag: string) => boolean } = {},
): ResourceCenterSectionType[] {
  if (!config || config.enabled === false) return [];
  const { flagEnabled } = options;
  return config.sections.filter((s) => !s.flag || (flagEnabled?.(s.flag) ?? false)).map((s) => s.type);
}
