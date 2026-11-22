// @module-tag dom
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

it('preserves the button styling slot when a tooltip decorates an active toolbar command', () => {
  render(
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button aria-pressed>Write</Button>
        </TooltipTrigger>
        <TooltipContent>Write prompt</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );
  expect(screen.getByRole('button', { name: 'Write' })).toHaveAttribute('data-slot', 'button');
  expect(screen.getByRole('button', { name: 'Write' })).toHaveAttribute('aria-pressed', 'true');
});
