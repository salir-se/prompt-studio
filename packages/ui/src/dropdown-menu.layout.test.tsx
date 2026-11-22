// @module-tag dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu';

describe('DropdownMenu layout contracts', () => {
  it('leaves layout ownership with an asChild trigger', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" data-testid="delegated-trigger">
            Actions
          </button>
        </DropdownMenuTrigger>
      </DropdownMenu>,
    );

    expect(document.querySelector('[data-testid="delegated-trigger"]')).not.toHaveAttribute('data-layout-contract');
  });

  it('declares truthful raw-trigger flow and nested popup boundaries', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger data-testid="trigger">
          <span>Actions</span>
          <span aria-hidden="true">+</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup data-testid="group">
            <DropdownMenuItem>Profile</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuRadioGroup data-testid="radio-group" value="comfortable">
            <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSub open>
            <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
            <DropdownMenuSubContent data-testid="sub-content">
              <DropdownMenuItem>Archive</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const trigger = document.querySelector('[data-testid="trigger"]');
    expect(trigger).toHaveAttribute('data-layout-contract', 'inline');
    expect(trigger).toHaveAttribute('data-layout-gap', '8');
    expect(trigger).toHaveAttribute('data-layout-align', 'center');
    expect(trigger).toHaveAttribute('data-layout-wrap', 'nowrap');
    expect(trigger).toHaveClass('inline-flex', 'items-center', 'gap-2');

    const content = document.querySelector('[data-slot="dropdown-menu-content"]');
    expect(content).toHaveAttribute('data-layout-contract', 'container');
    expect(content).toHaveAttribute('data-layout-overflow-x', 'hidden');
    expect(content).not.toHaveAttribute('data-layout-contain');
    expect(content).not.toHaveAttribute('data-layout-gap');
    expect(document.querySelector('[data-testid="group"]')).toHaveAttribute('data-layout-contract', 'grid');
    expect(document.querySelector('[data-testid="radio-group"]')).toHaveAttribute('data-layout-contract', 'grid');

    const subContent = document.querySelector('[data-testid="sub-content"]');
    expect(subContent).toHaveAttribute('data-layout-contract', 'container');
    expect(subContent).toHaveAttribute('data-layout-overflow-x', 'hidden');
    expect(subContent).not.toHaveAttribute('data-layout-contain');
    expect(subContent).not.toHaveAttribute('data-layout-gap');
  });
});
