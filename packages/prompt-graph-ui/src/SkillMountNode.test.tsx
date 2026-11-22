// @module-tag dom
/**
 * BDD tests for SkillMountNode.
 *
 * Behaviour contracts:
 *  - Renders `label` as an accessible heading.
 *  - Shows an emerald-tinted "skill" kind chip.
 *  - Renders `name@version` when `version` is given, `name` alone otherwise.
 *  - Renders the mount tag as `<mountTag>`.
 *  - Renders the `·` separator only when a mount tag follows it — never a dangling trailing separator.
 *  - Defaults `redacted` to `true`, showing the redaction notice — never a body.
 *  - `redacted: false` with a `summary` renders that summary instead of the redaction notice.
 *  - `redacted: false` with no `summary` renders neither the redaction notice nor a body placeholder.
 *  - `redacted: true` always wins, even when `summary` is also given (never leaks a body).
 *  - Exposes selection via `data-selected` / `aria-current`, off by default.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SkillMountNode } from './SkillMountNode';

describe('SkillMountNode', () => {
  it('renders the label as a heading', () => {
    render(<SkillMountNode name="sales-humanizer" label="Sales humanizer" mountTag="session_learning_closeout" />);
    expect(screen.getByRole('heading', { name: 'Sales humanizer' })).toBeInTheDocument();
  });

  it('shows an emerald-tinted "skill" kind chip', () => {
    render(<SkillMountNode name="sales-humanizer" label="Sales humanizer" mountTag="session_learning_closeout" />);
    const chip = screen.getByText('skill');
    expect(chip).toBeInTheDocument();
    expect(chip.className).toMatch(/emerald/);
  });

  it('renders name@version when version is given', () => {
    render(
      <SkillMountNode
        name="sales-humanizer"
        label="Sales humanizer"
        version="1"
        mountTag="session_learning_closeout"
      />,
    );
    expect(screen.getByText('sales-humanizer@1')).toBeInTheDocument();
  });

  it('renders the bare name when version is omitted', () => {
    render(<SkillMountNode name="sales-humanizer" label="Sales humanizer" mountTag="session_learning_closeout" />);
    expect(screen.getByText('sales-humanizer')).toBeInTheDocument();
  });

  it('renders the mount tag as <mountTag>', () => {
    render(<SkillMountNode name="sales-humanizer" label="Sales humanizer" mountTag="session_learning_closeout" />);
    expect(screen.getByText('<session_learning_closeout>')).toBeInTheDocument();
  });

  it('renders the · separator when a mount tag follows the version', () => {
    render(
      <SkillMountNode
        name="sales-humanizer"
        label="Sales humanizer"
        version="1"
        mountTag="session_learning_closeout"
      />,
    );
    expect(screen.getByText('·')).toBeInTheDocument();
  });

  it('omits the dangling · separator when there is no mount tag to follow it', () => {
    render(<SkillMountNode name="sales-humanizer" label="Sales humanizer" version="1" mountTag="" />);
    expect(screen.queryByText('·')).not.toBeInTheDocument();
    const card = screen.getByTestId('skill-mount-node');
    expect(card.textContent?.trimEnd().endsWith('·')).toBe(false);
  });

  it('defaults redacted to true and shows the protected-content notice', () => {
    render(<SkillMountNode name="sales-humanizer" label="Sales humanizer" mountTag="session_learning_closeout" />);
    expect(screen.getByTestId('skill-mount-node-redacted')).toBeInTheDocument();
    expect(screen.getByText(/Protected content/i)).toBeInTheDocument();
  });

  it('renders no summary text while redacted, even if summary is given', () => {
    render(
      <SkillMountNode
        name="sales-humanizer"
        label="Sales humanizer"
        mountTag="session_learning_closeout"
        summary="Rewrites outbound emails to sound human."
      />,
    );
    expect(screen.getByTestId('skill-mount-node-redacted')).toBeInTheDocument();
    expect(screen.queryByTestId('skill-mount-node-summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Rewrites outbound emails to sound human.')).not.toBeInTheDocument();
  });

  it('renders the summary instead of the redaction notice when redacted is false', () => {
    render(
      <SkillMountNode
        name="sales-humanizer"
        label="Sales humanizer"
        mountTag="session_learning_closeout"
        redacted={false}
        summary="Rewrites outbound emails to sound human."
      />,
    );
    expect(screen.queryByTestId('skill-mount-node-redacted')).not.toBeInTheDocument();
    expect(screen.getByTestId('skill-mount-node-summary')).toHaveTextContent(
      'Rewrites outbound emails to sound human.',
    );
  });

  it('renders neither the redaction notice nor a summary when redacted is false and no summary is given', () => {
    render(
      <SkillMountNode
        name="sales-humanizer"
        label="Sales humanizer"
        mountTag="session_learning_closeout"
        redacted={false}
      />,
    );
    expect(screen.queryByTestId('skill-mount-node-redacted')).not.toBeInTheDocument();
    expect(screen.queryByTestId('skill-mount-node-summary')).not.toBeInTheDocument();
  });

  it('is not marked selected by default', () => {
    render(<SkillMountNode name="sales-humanizer" label="Sales humanizer" mountTag="session_learning_closeout" />);
    expect(screen.getByTestId('skill-mount-node')).toHaveAttribute('data-selected', 'false');
  });

  it('marks the card selected via data-selected, aria-current, and a ring when selected is true', () => {
    render(
      <SkillMountNode name="sales-humanizer" label="Sales humanizer" mountTag="session_learning_closeout" selected />,
    );
    const card = screen.getByTestId('skill-mount-node');
    expect(card).toHaveAttribute('data-selected', 'true');
    expect(card).toHaveAttribute('aria-current', 'true');
    expect(card.className).toMatch(/ring-2/);
  });
});
