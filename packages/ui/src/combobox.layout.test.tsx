// @module-tag dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Combobox,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from './combobox';

describe('Combobox layout contracts', () => {
  it('declares stable trigger, popup, group, and item relationships', () => {
    render(
      <Combobox open>
        <ComboboxInput aria-label="Region" />
        <ComboboxContent>
          <ComboboxList>
            <ComboboxGroup>
              <ComboboxLabel>Europe</ComboboxLabel>
              <ComboboxItem value="stockholm">Stockholm</ComboboxItem>
            </ComboboxGroup>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>,
    );

    const trigger = document.querySelector('[data-slot="input-group-addon"] button');
    const content = document.querySelector('[data-slot="combobox-content"]');
    const group = document.querySelector('[data-slot="combobox-group"]');
    const item = document.querySelector('[data-slot="combobox-item"]');

    expect(trigger).toHaveAttribute('data-layout-contract', 'inline');
    expect(trigger).toHaveAttribute('data-layout-gap', '8');
    expect(trigger).toHaveAttribute('data-layout-align', 'center');
    expect(trigger).toHaveAttribute('data-layout-wrap', 'nowrap');
    expect(content).toHaveAttribute('data-layout-contract', 'container');
    expect(content).toHaveAttribute('data-layout-contain', 'true');
    expect(group).toHaveAttribute('data-layout-contract', 'grid');
    expect(item).toHaveAttribute('data-layout-contract', 'container');
    expect(item).toHaveAttribute('data-layout-contain', 'true');
  });

  it('never scrolls the list horizontally — a wide item is clipped, like Select and DropdownMenu', () => {
    render(
      <Combobox open>
        <ComboboxInput aria-label="Configuration" />
        <ComboboxContent>
          <ComboboxList>
            <ComboboxItem value="wide">
              <span className="whitespace-nowrap">{'A very long configuration description '.repeat(8)}</span>
            </ComboboxItem>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>,
    );

    const list = document.querySelector('[data-slot="combobox-list"]');
    expect(list).toHaveClass('overflow-x-hidden');
    expect(list).toHaveClass('overflow-y-auto');
    // The declared contract is what the layout inspector measures in a real browser (scrollWidth vs
    // clientWidth); the class alone is only the fix, this is the regression gate.
    expect(list).toHaveAttribute('data-layout-contract', 'container');
    expect(list).toHaveAttribute('data-layout-overflow-x', 'hidden');
    // Base UI flags a children-rendered list as `data-empty`; the padding must follow the rendered items,
    // or the full-bleed separator overhangs a padding-less box (the 4 px behind the scrollbar).
    expect(list).toHaveClass('not-has-[[data-slot=combobox-item]]:p-0');
    expect(list).not.toHaveClass('data-empty:p-0');
  });
});
