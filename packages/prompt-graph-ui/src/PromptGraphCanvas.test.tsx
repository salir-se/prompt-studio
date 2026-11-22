// @module-tag dom
/** Canvas DOM outcomes; fixture measurements let xyflow render edges under happy-dom. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptGraphCanvas } from './PromptGraphCanvas';
import {
  edgeStroke,
  EMPTY_MODEL,
  NESTED_MODEL,
  SMALL_MODEL,
  StubResizeObserver,
  TWO_SECTION_MODEL,
} from './PromptGraphCanvas.test.fixtures';
import { LAYOUT_COLLAPSED_ROW_HEIGHT, LAYOUT_ROW_HEIGHT } from './layout';

describe('PromptGraphCanvas', () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

  beforeEach(() => {
    globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
    // See the module doc above — a non-zero `offsetWidth`/`offsetHeight` on every element is the
    // other half of getting xyflow to compute (and render) edge geometry under happy-dom.
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 200 });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 40 });
  });

  afterEach(() => {
    cleanup();
    globalThis.ResizeObserver = originalResizeObserver;
    if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
    if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
  });

  it('mounts without throwing for a small model', () => {
    expect(() => render(<PromptGraphCanvas model={SMALL_MODEL} />)).not.toThrow();
  });

  it('mounts without throwing for an empty model', () => {
    expect(() => render(<PromptGraphCanvas model={EMPTY_MODEL} />)).not.toThrow();
  });

  it('renders a centered empty-state message instead of a bare canvas for an empty model', () => {
    render(<PromptGraphCanvas model={EMPTY_MODEL} />);
    expect(screen.getByText('No prompt sections to display.')).toBeInTheDocument();
  });

  it('fires onEditNode with the section node id when its card edit button is clicked', () => {
    const onEditNode = vi.fn();
    render(<PromptGraphCanvas model={SMALL_MODEL} onEditNode={onEditNode} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit section' }));
    expect(onEditNode).toHaveBeenCalledTimes(1);
    expect(onEditNode).toHaveBeenCalledWith('section:mission');
  });

  it('renders no edit button when onEditNode is omitted (default-off)', () => {
    render(<PromptGraphCanvas model={SMALL_MODEL} />);
    expect(screen.queryByRole('button', { name: 'Edit section' })).not.toBeInTheDocument();
  });

  it('renders the model edge label for a declares edge (why the target node exists)', () => {
    const { container } = render(<PromptGraphCanvas model={SMALL_MODEL} />);
    // `SMALL_MODEL`'s two `declares` edges carry `label: '{{company_name}}'` and `label: 'lookup_customer'`
    // (see `PromptGraphEdge.label`'s doc) — xyflow renders an edge's `label` into a real
    // `.react-flow__edge-text` SVG `<text>` element, distinct from the (unlabeled) chip a section's
    // own `FragmentNode` renders for the same variable/tool name — so this queries that specific
    // element rather than `getByText`, which would otherwise match the section card's chip too.
    const edgeLabelTexts = Array.from(container.querySelectorAll('.react-flow__edge-text')).map((el) => el.textContent);
    expect(edgeLabelTexts).toEqual(expect.arrayContaining(['{{company_name}}', 'lookup_customer']));
  });

  it('collapses a section node to its one-line form and back via its own chevron toggle', () => {
    render(<PromptGraphCanvas model={SMALL_MODEL} />);

    // Expanded by default: the section's body text is present.
    expect(screen.getByText('Classify the customer message by category and urgency.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse section' }));
    expect(screen.queryByText('Classify the customer message by category and urgency.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand section' }));
    expect(screen.getByText('Classify the customer message by category and urgency.')).toBeInTheDocument();
  });

  it('collapses every section node via the "Collapse all sections" zoom-panel button', () => {
    render(<PromptGraphCanvas model={TWO_SECTION_MODEL} />);

    expect(screen.getByText('Classify the customer message by category and urgency.')).toBeInTheDocument();
    expect(screen.getByText('Propose one next step for the support team.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all sections' }));

    expect(screen.queryByText('Classify the customer message by category and urgency.')).not.toBeInTheDocument();
    expect(screen.queryByText('Propose one next step for the support team.')).not.toBeInTheDocument();
    const expandButtons = screen.getAllByRole('button', { name: 'Expand section' });
    expect(expandButtons).toHaveLength(2);
    for (const expandButton of expandButtons) {
      expect(expandButton).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('restores every section node via "Expand all sections" after a bulk collapse', () => {
    render(<PromptGraphCanvas model={TWO_SECTION_MODEL} />);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all sections' }));
    expect(screen.queryByText('Classify the customer message by category and urgency.')).not.toBeInTheDocument();
    expect(screen.queryByText('Propose one next step for the support team.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand all sections' }));

    expect(screen.getByText('Classify the customer message by category and urgency.')).toBeInTheDocument();
    expect(screen.getByText('Propose one next step for the support team.')).toBeInTheDocument();
    const collapseButtons = screen.getAllByRole('button', { name: 'Collapse section' });
    expect(collapseButtons).toHaveLength(2);
    for (const collapseButton of collapseButtons) {
      expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    }
  });

  it('still lets an individual chevron toggle a single section after a bulk "Collapse all sections"', () => {
    render(<PromptGraphCanvas model={TWO_SECTION_MODEL} />);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all sections' }));
    expect(screen.queryByText('Classify the customer message by category and urgency.')).not.toBeInTheDocument();
    expect(screen.queryByText('Propose one next step for the support team.')).not.toBeInTheDocument();

    // Expand just the mission card via its own per-card chevron — the bulk action set both cards'
    // map entries individually (see `PromptGraphCanvas`'s `handleCollapseAll` doc), so a single-card
    // toggle afterwards must flip only that one entry, leaving the process card untouched.
    const missionCard = screen.getByRole('article', { name: 'YOUR MISSION' });
    fireEvent.click(within(missionCard).getByRole('button', { name: 'Expand section' }));

    expect(screen.getByText('Classify the customer message by category and urgency.')).toBeInTheDocument();
    expect(screen.queryByText('Propose one next step for the support team.')).not.toBeInTheDocument();
  });

  // ── Collapse-aware re-layout + double-click toggle ──────────────────────────

  /** Reads a node wrapper's xyflow position off its inline `transform` — see `edgeStroke`'s doc for
   *  why inline style, not `getComputedStyle`, is the reliable read in happy-dom. */
  function nodeTransform(container: HTMLElement, nodeId: string): string {
    const wrapper = container.querySelector(`[data-id="${CSS.escape(nodeId)}"]`) as HTMLElement;
    return wrapper.style.transform;
  }

  it('re-lays-out the column when "Collapse all sections" collapses every card, and restores it on "Expand all sections"', () => {
    const { container } = render(<PromptGraphCanvas model={TWO_SECTION_MODEL} />);

    // Both sections share the depth-1 column: expanded, the second sits one full row below the first.
    expect(nodeTransform(container, 'section:process')).toContain(`translate(420px,${LAYOUT_ROW_HEIGHT}px)`);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all sections' }));
    expect(nodeTransform(container, 'section:process')).toContain(`translate(420px,${LAYOUT_COLLAPSED_ROW_HEIGHT}px)`);

    fireEvent.click(screen.getByRole('button', { name: 'Expand all sections' }));
    expect(nodeTransform(container, 'section:process')).toContain(`translate(420px,${LAYOUT_ROW_HEIGHT}px)`);
  });

  it("re-lays-out the column when a single card's own chevron collapses it", () => {
    const { container } = render(<PromptGraphCanvas model={TWO_SECTION_MODEL} />);

    const missionCard = screen.getByRole('article', { name: 'YOUR MISSION' });
    fireEvent.click(within(missionCard).getByRole('button', { name: 'Collapse section' }));

    // Only the first card collapsed, so the second card moves up to the collapsed slot boundary.
    expect(nodeTransform(container, 'section:process')).toContain(`translate(420px,${LAYOUT_COLLAPSED_ROW_HEIGHT}px)`);
  });

  it('toggles a section card collapsed and back via double-click', () => {
    render(<PromptGraphCanvas model={SMALL_MODEL} />);

    const missionCard = screen.getByRole('article', { name: 'YOUR MISSION' });
    expect(screen.getByText('Classify the customer message by category and urgency.')).toBeInTheDocument();

    fireEvent.doubleClick(missionCard);
    expect(screen.queryByText('Classify the customer message by category and urgency.')).not.toBeInTheDocument();

    fireEvent.doubleClick(screen.getByRole('article', { name: 'YOUR MISSION' }));
    expect(screen.getByText('Classify the customer message by category and urgency.')).toBeInTheDocument();
  });

  it('ignores a double-click on a variable/tool chip, but opens the edit affordance on the ROOT chip', () => {
    const onEditNode = vi.fn();
    const { container } = render(<PromptGraphCanvas model={SMALL_MODEL} onEditNode={onEditNode} />);

    // Target the shared variable LabelChip node specifically — the section card renders a chip
    // with the same text, so a bare text query would be ambiguous.
    fireEvent.doubleClick(container.querySelector('[data-id="variable:company_name"]') as HTMLElement);
    expect(onEditNode).not.toHaveBeenCalled();
    // Section cards keep their body: nothing collapsed by the chip double-click either.
    expect(screen.getByText('Classify the customer message by category and urgency.')).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByText('support-triage'));
    expect(onEditNode).toHaveBeenCalledWith('root:support-triage');
  });

  it("forwards a selected card's structure-action clicks to the host with the section node id", () => {
    const onAddSiblingSection = vi.fn();
    const onMoveSection = vi.fn();
    render(
      <PromptGraphCanvas
        model={TWO_SECTION_MODEL}
        selectedNodeId="section:mission"
        onAddSiblingSection={onAddSiblingSection}
        onMoveSection={onMoveSection}
      />,
    );

    const missionCard = screen.getByRole('article', { name: 'YOUR MISSION' });
    fireEvent.click(within(missionCard).getByRole('button', { name: 'Add section after' }));
    fireEvent.click(within(missionCard).getByRole('button', { name: 'Move section down' }));

    expect(onAddSiblingSection).toHaveBeenCalledWith('section:mission');
    expect(onMoveSection).toHaveBeenCalledWith('section:mission', 'down');
    // The unselected card renders no toolbar at all.
    const processCard = screen.getByRole('article', { name: 'PROCESS' });
    expect(within(processCard).queryByTestId('fragment-node-actions')).not.toBeInTheDocument();
  });

  // ── Ancestor-path selection highlight (selection-path.ts wiring) ────────────

  it("marks a selected depth-2 section's ancestor chain on-path and its connecting edges with the stronger stroke", () => {
    const { container } = render(<PromptGraphCanvas model={NESTED_MODEL} selectedNodeId="section:child" />);

    // The selected node itself: `selected`, not `onPath` (it keeps its own stronger ring instead).
    const childCard = screen.getByRole('article', { name: 'CHILD SECTION' });
    expect(childCard).toHaveAttribute('data-selected', 'true');
    expect(childCard).toHaveAttribute('data-on-path', 'false');

    // Its parent section and the root chip are both on the path back to the root.
    const parentCard = screen.getByRole('article', { name: 'PARENT SECTION' });
    expect(parentCard).toHaveAttribute('data-selected', 'false');
    expect(parentCard).toHaveAttribute('data-on-path', 'true');
    expect(screen.getByText('support-triage').closest('[data-testid="label-chip"]')).toHaveAttribute(
      'data-on-path',
      'true',
    );

    // An unrelated sibling section is neither selected nor on-path.
    const siblingCard = screen.getByRole('article', { name: 'SIBLING SECTION' });
    expect(siblingCard).toHaveAttribute('data-selected', 'false');
    expect(siblingCard).toHaveAttribute('data-on-path', 'false');

    // Both edges connecting the path (root->parent, parent->child) render the stronger, fully-opaque
    // primary-token stroke; the sibling's own (non-path) edge is dimmed instead.
    expect(edgeStroke(container, 'contains:root->parent')).toEqual({
      stroke: 'var(--primary)',
      strokeWidth: '2.5',
      opacity: '1',
    });
    expect(edgeStroke(container, 'contains:parent->child')).toEqual({
      stroke: 'var(--primary)',
      strokeWidth: '2.5',
      opacity: '1',
    });
    expect(edgeStroke(container, 'contains:root->sibling')).toEqual({
      stroke: 'var(--muted-foreground)',
      strokeWidth: '1.5',
      opacity: '0.35',
    });
  });

  it('restores every node/edge to its unhighlighted state when the selection is cleared', () => {
    const { container, rerender } = render(<PromptGraphCanvas model={NESTED_MODEL} selectedNodeId="section:child" />);

    // Sanity check the highlighted state is actually present before clearing it.
    expect(screen.getByRole('article', { name: 'PARENT SECTION' })).toHaveAttribute('data-on-path', 'true');

    rerender(<PromptGraphCanvas model={NESTED_MODEL} />);

    expect(screen.getByRole('article', { name: 'CHILD SECTION' })).toHaveAttribute('data-selected', 'false');
    expect(screen.getByRole('article', { name: 'PARENT SECTION' })).toHaveAttribute('data-on-path', 'false');
    expect(screen.getByRole('article', { name: 'SIBLING SECTION' })).toHaveAttribute('data-on-path', 'false');
    expect(screen.getByText('support-triage').closest('[data-testid="label-chip"]')).toHaveAttribute(
      'data-on-path',
      'false',
    );

    // No selection at all → every edge is back to its plain, undimmed stroke (no `opacity` override).
    expect(edgeStroke(container, 'contains:root->parent')).toEqual({
      stroke: 'var(--muted-foreground)',
      strokeWidth: '1.5',
      opacity: '',
    });
    expect(edgeStroke(container, 'contains:root->sibling')).toEqual({
      stroke: 'var(--muted-foreground)',
      strokeWidth: '1.5',
      opacity: '',
    });
  });

  // ── verificationByNodeId forwarding (ADR-202 Stage D) ───────────────────────

  it('forwards a verificationByNodeId entry to exactly the section node it is keyed by', () => {
    render(
      <PromptGraphCanvas
        model={TWO_SECTION_MODEL}
        verificationByNodeId={{ 'section:mission': { state: 'invalid', findingCount: 2 } }}
      />,
    );

    // The keyed node gets the full treatment: state attribute (border evidence) + finding chip.
    const missionCard = screen.getByRole('article', { name: 'YOUR MISSION — verification: invalid' });
    expect(missionCard).toHaveAttribute('data-verification-state', 'invalid');
    expect(within(missionCard).getByTestId('fragment-node-finding-count')).toHaveTextContent('2 findings');

    // The node ABSENT from the record gets no `verification` prop at all — untouched, not "valid".
    const processCard = screen.getByRole('article', { name: 'PROCESS' });
    expect(processCard).not.toHaveAttribute('data-verification-state');
    expect(within(processCard).queryByTestId('fragment-node-finding-count')).not.toBeInTheDocument();
  });

  it('renders no verification treatment on any card when verificationByNodeId is omitted (default-off)', () => {
    render(<PromptGraphCanvas model={TWO_SECTION_MODEL} />);
    for (const title of ['YOUR MISSION', 'PROCESS']) {
      expect(screen.getByRole('article', { name: title })).not.toHaveAttribute('data-verification-state');
    }
    expect(screen.queryByTestId('fragment-node-finding-count')).not.toBeInTheDocument();
  });

  it('marks the first and last section in source order as positional anchors', () => {
    render(<PromptGraphCanvas model={TWO_SECTION_MODEL} />);

    expect(screen.getByRole('article', { name: 'YOUR MISSION' })).toHaveAttribute('data-prompt-anchor', 'opening');
    expect(screen.getByRole('article', { name: 'PROCESS' })).toHaveAttribute('data-prompt-anchor', 'closing');
  });

  it('marks a single section as both opening and closing anchor', () => {
    render(<PromptGraphCanvas model={SMALL_MODEL} />);

    expect(screen.getByRole('article', { name: 'YOUR MISSION' })).toHaveAttribute('data-prompt-anchor', 'both');
  });

  it('ignores verificationByNodeId entries keyed by non-section (root/variable/tool) node ids', () => {
    const { container } = render(
      <PromptGraphCanvas
        model={SMALL_MODEL}
        verificationByNodeId={{
          'root:support-triage': { state: 'invalid', findingCount: 1 },
          'variable:company_name': { state: 'warning', findingCount: 1 },
          'tool:lookup_customer': { state: 'degraded', findingCount: 1 },
        }}
      />,
    );
    // None of those ids is a section node, so no card (nor chip) anywhere carries the treatment.
    expect(container.querySelector('[data-verification-state]')).toBeNull();
    expect(screen.queryByTestId('fragment-node-finding-count')).not.toBeInTheDocument();
  });
});
