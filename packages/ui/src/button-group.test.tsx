// @module-tag dom
/**
 * Tests for the ButtonGroup primitive (shadcn "button-group").
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from './button-group';

describe('ButtonGroup', () => {
  it('renders an accessible group that owns its buttons', () => {
    // Given: a labelled two-way mode switch
    render(
      <ButtonGroup aria-label="Automation mode">
        <Button variant="outline" aria-pressed>
          Manual
        </Button>
        <Button variant="outline" aria-pressed={false}>
          Automated
        </Button>
      </ButtonGroup>,
    );

    // Then: assistive tech sees one named group holding both buttons
    const group = screen.getByRole('group', { name: 'Automation mode' });
    expect(group).toHaveAttribute('data-slot', 'button-group');
    expect(group).toHaveAttribute('data-orientation', 'horizontal');
    expect(group).toHaveAttribute('data-layout-contract', 'inline');
    expect(within(group).getAllByRole('button')).toHaveLength(2);
    expect(within(group).getByRole('button', { name: 'Manual' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('exposes the vertical orientation as data for styling and the layout inspector', () => {
    render(
      <ButtonGroup orientation="vertical" aria-label="Zoom">
        <Button>In</Button>
        <Button>Out</Button>
      </ButtonGroup>,
    );
    const group = screen.getByRole('group', { name: 'Zoom' });
    expect(group).toHaveAttribute('data-orientation', 'vertical');
    // And: the layout inspector reads it as a zero-gap stack (a horizontal group is a zero-gap inline row)
    expect(group).toHaveAttribute('data-layout-contract', 'stack');
    expect(group).toHaveAttribute('data-layout-gap', '0');
  });

  it('renders text and separator parts as slots inside the group', () => {
    render(
      <ButtonGroup aria-label="Pager">
        <ButtonGroupText>Page</ButtonGroupText>
        <ButtonGroupSeparator />
        <Button>Next</Button>
      </ButtonGroup>,
    );
    const group = screen.getByRole('group', { name: 'Pager' });
    expect(within(group).getByText('Page')).toHaveAttribute('data-slot', 'button-group-text');
    expect(group.querySelector('[data-slot="button-group-separator"]')).not.toBeNull();
  });

  it('renders ButtonGroupText as the element the caller provides', () => {
    render(
      <ButtonGroup aria-label="Labelled">
        <ButtonGroupText render={<label htmlFor="q">Search</label>} />
        <input id="q" />
      </ButtonGroup>,
    );
    expect(screen.getByText('Search').tagName).toBe('LABEL');
    expect(screen.getByLabelText('Search')).toHaveAttribute('id', 'q');
  });
});
