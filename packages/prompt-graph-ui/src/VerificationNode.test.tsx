// @module-tag dom
/**
 * BDD tests for VerificationNode.
 *
 * Behaviour contracts:
 *  - Renders `title` as an accessible heading.
 *  - Shows a state badge reading the exact `PromptVerificationState` value, tinted per state
 *    (verified = emerald, warning = amber, invalid = destructive, degraded = slate, valid = muted).
 *  - Renders one principle row per entry in `principles`, showing its id, statement, and owner chip.
 *  - Tints the owner chip violet for `platform`, neutral for `configuration`.
 *  - Renders no principles section when `principles` is empty.
 *  - Renders one finding row per entry in `findings`, showing its severity and message.
 *  - Renders no findings section when `findings` is omitted/empty.
 *  - Exposes selection via `data-selected` / `aria-current`, off by default.
 */

import type { PromptVerificationFinding, PromptVerificationPrinciple } from '@prompt-studio/prompts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VerificationNode } from './VerificationNode';

const MISSION_PRINCIPLE: PromptVerificationPrinciple = {
  id: 'semantic-mission',
  version: 1,
  owner: 'platform',
  statement: 'Find companies with delegation-ready hiring signals and score them 0-100.',
  severity: 'error',
  allowedCustomization: 'Wording may change while the prompt keeps its declared functional contract.',
  sectionIds: [],
};

const TOOLS_PRINCIPLE: PromptVerificationPrinciple = {
  id: 'semantic-tools',
  version: 1,
  owner: 'configuration',
  statement: 'Preserve load-bearing tool usage, ordering, and preconditions.',
  severity: 'warning',
  allowedCustomization: 'Wording may change while the prompt keeps its declared functional contract.',
  sectionIds: [],
};

const WARNING_FINDING: PromptVerificationFinding = {
  profile: { id: 'scout', version: 1 },
  scope: 'blueprint',
  severity: 'warning',
  message: 'Section reorder changed the search-strategy ordering relative to the mission statement.',
  source: 'semantic',
  principleId: 'semantic-tools',
  evidenceQuote: 'Query job boards before scoring.',
  proposedCorrection: 'Restore the original section order.',
};

describe('VerificationNode', () => {
  it('renders the title as a heading', () => {
    render(<VerificationNode title="scout" state="valid" principles={[]} />);
    expect(screen.getByRole('heading', { name: 'scout' })).toBeInTheDocument();
  });

  it.each([
    ['valid', 'valid'],
    ['verified', 'verified'],
    ['warning', 'warning'],
    ['invalid', 'invalid'],
    ['degraded', 'degraded'],
  ] as const)('shows a %s state badge reading "%s"', (state, expectedLabel) => {
    render(<VerificationNode title="scout" state={state} principles={[]} />);
    expect(screen.getByTestId('verification-node-state')).toHaveTextContent(expectedLabel);
  });

  it('applies a distinct emerald tint for the verified state', () => {
    render(<VerificationNode title="scout" state="verified" principles={[]} />);
    expect(screen.getByTestId('verification-node-state').className).toMatch(/emerald/);
  });

  it('applies a distinct amber tint for the warning state', () => {
    render(<VerificationNode title="scout" state="warning" principles={[]} />);
    expect(screen.getByTestId('verification-node-state').className).toMatch(/amber/);
  });

  it('applies a distinct destructive tint for the invalid state', () => {
    render(<VerificationNode title="scout" state="invalid" principles={[]} />);
    expect(screen.getByTestId('verification-node-state').className).toMatch(/destructive/);
  });

  it('applies a distinct slate tint for the degraded state', () => {
    render(<VerificationNode title="scout" state="degraded" principles={[]} />);
    expect(screen.getByTestId('verification-node-state').className).toMatch(/slate/);
  });

  it('renders a row per principle, showing its id and statement', () => {
    render(<VerificationNode title="scout" state="valid" principles={[MISSION_PRINCIPLE, TOOLS_PRINCIPLE]} />);
    expect(screen.getByText('semantic-mission')).toBeInTheDocument();
    expect(screen.getByText(MISSION_PRINCIPLE.statement)).toBeInTheDocument();
    expect(screen.getByText('semantic-tools')).toBeInTheDocument();
    expect(screen.getByText(TOOLS_PRINCIPLE.statement)).toBeInTheDocument();
  });

  it('tints the platform owner chip violet', () => {
    render(<VerificationNode title="scout" state="valid" principles={[MISSION_PRINCIPLE]} />);
    expect(screen.getByText('platform').className).toMatch(/violet/);
  });

  it('does not tint the configuration owner chip violet', () => {
    render(<VerificationNode title="scout" state="valid" principles={[TOOLS_PRINCIPLE]} />);
    expect(screen.getByText('configuration').className).not.toMatch(/violet/);
  });

  it('renders no principles section when principles is empty', () => {
    render(<VerificationNode title="scout" state="valid" principles={[]} />);
    expect(screen.queryByLabelText('Principles')).not.toBeInTheDocument();
  });

  it('renders a row per finding, showing its severity and message', () => {
    // `state="invalid"` (not "warning") so the state badge and the finding's severity badge render
    // distinct text — otherwise both would independently match `getByText('warning')`.
    render(<VerificationNode title="scout" state="invalid" principles={[]} findings={[WARNING_FINDING]} />);
    expect(screen.getByText('warning')).toBeInTheDocument();
    expect(screen.getByText(WARNING_FINDING.message)).toBeInTheDocument();
  });

  it('renders no findings section when findings is omitted', () => {
    render(<VerificationNode title="scout" state="valid" principles={[]} />);
    expect(screen.queryByLabelText('Findings')).not.toBeInTheDocument();
  });

  it('is not marked selected by default', () => {
    render(<VerificationNode title="scout" state="valid" principles={[]} />);
    expect(screen.getByTestId('verification-node')).toHaveAttribute('data-selected', 'false');
  });

  it('marks the card selected via data-selected, aria-current, and a ring when selected is true', () => {
    render(<VerificationNode title="scout" state="valid" principles={[]} selected />);
    const card = screen.getByTestId('verification-node');
    expect(card).toHaveAttribute('data-selected', 'true');
    expect(card).toHaveAttribute('aria-current', 'true');
    expect(card.className).toMatch(/ring-2/);
  });
});
