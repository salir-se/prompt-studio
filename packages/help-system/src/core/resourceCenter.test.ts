// @module-tag dom
import { describe, expect, it } from 'vitest';
import { resolveResourceCenterSections, type ResourceCenterConfig } from './resourceCenter';

const config: ResourceCenterConfig = {
  enabled: true,
  sections: [
    { type: 'search' },
    { type: 'popular' },
    { type: 'checklists', flag: 'help-checklists' },
    { type: 'ask_ai' },
  ],
};

describe('resolveResourceCenterSections', () => {
  it('returns sections in author order, dropping flag-gated ones by default', () => {
    expect(resolveResourceCenterSections(config)).toEqual(['search', 'popular', 'ask_ai']);
  });

  it('includes a flag-gated section when its flag is on', () => {
    expect(resolveResourceCenterSections(config, { flagEnabled: (f) => f === 'help-checklists' })).toEqual([
      'search',
      'popular',
      'checklists',
      'ask_ai',
    ]);
  });

  it('returns nothing when the home is absent or disabled', () => {
    expect(resolveResourceCenterSections(undefined)).toEqual([]);
    expect(resolveResourceCenterSections({ enabled: false, sections: [{ type: 'search' }] })).toEqual([]);
  });
});
