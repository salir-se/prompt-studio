// @module-tag dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';

describe('<Dialog> layering (#1643)', () => {
  function renderOpenDialog() {
    return render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this email?</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );
  }

  it('#1643: stacks the content above its own overlay', () => {
    renderOpenDialog();
    const content = screen.getByRole('dialog');
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.className).toContain('z-50');
    // A reopen during the exit interval can mount the overlay after the
    // content; an equal z-index then lets the overlay intercept clicks.
    expect(content.className).toContain('z-51');
  });

  it('#1643: gives the overlay the same exit duration as the content', () => {
    renderOpenDialog();
    const content = screen.getByRole('dialog');
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(content.className).toContain('duration-200');
    expect(overlay?.className).toContain('duration-200');
  });
});
