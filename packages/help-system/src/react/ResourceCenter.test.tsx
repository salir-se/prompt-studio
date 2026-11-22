// @module-tag dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ResourceCenterConfig } from '../core/resourceCenter';
import { ResourceCenter } from './ResourceCenter';

const config: ResourceCenterConfig = {
  enabled: true,
  sections: [{ type: 'search' }, { type: 'popular' }, { type: 'ask_ai' }],
};

describe('ResourceCenter', () => {
  it('renders provided slots in section order, skipping sections with no slot', () => {
    render(<ResourceCenter config={config} slots={{ search: <div>search-box</div>, ask_ai: <div>ask-ai</div> }} />);
    const home = screen.getByLabelText('Help home');
    const sections = home.querySelectorAll('section[data-section]');
    // `popular` has no slot → skipped; order preserved.
    expect([...sections].map((s) => s.getAttribute('data-section'))).toEqual(['search', 'ask_ai']);
    expect(screen.getByText('search-box')).toBeInTheDocument();
  });

  it('renders nothing when disabled or no slot is visible', () => {
    const { container: c1 } = render(
      <ResourceCenter config={{ enabled: false, sections: [{ type: 'search' }] }} slots={{ search: <div>x</div> }} />,
    );
    expect(c1).toBeEmptyDOMElement();
    const { container: c2 } = render(<ResourceCenter config={config} slots={{}} />);
    expect(c2).toBeEmptyDOMElement();
  });
});
