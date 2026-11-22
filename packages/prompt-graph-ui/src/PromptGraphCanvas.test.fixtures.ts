/**
 * Shared fixtures for the `PromptGraphCanvas` render-smoke and behaviour tests.
 *
 * xyflow (`@xyflow/react`) needs real layout/`ResizeObserver`/viewport APIs that happy-dom does not
 * fully provide, so the bulk of this file stays a render-smoke suite (mount/unmount without
 * throwing, for a small model and for an empty model) rather than exercising xyflow's own
 * drag/zoom/pan internals. `FragmentNode`'s rendered content (the section card's header buttons and
 * body text) IS real DOM inside each section node, though, so the `onEditNode`/collapse-toggle
 * tests below click those buttons directly — they exercise this canvas's own wiring
 * (`toFlowNode`/`SectionNodeData`/the collapse `Map`), not xyflow's viewport interactions.
 *
 * The one exception is the edge-label test below: xyflow only draws an edge (and any label on it)
 * once BOTH endpoint nodes report real `offsetWidth`/`offsetHeight` (its own dimension gate — see
 * `@xyflow/system`'s `updateNodeInternals`, which no-ops when either is falsy) AND its
 * `ResizeObserver` has actually fired to record that measurement. happy-dom implements neither: every
 * element's `offsetWidth`/`offsetHeight` is permanently `0` (it never runs real CSS layout), and a
 * plain do-nothing `ResizeObserver` stub — enough for every OTHER test here, which only asserts on
 * node content — never invokes its callback at all. So immediately below, `StubResizeObserver` fires
 * its callback synchronously from `observe()` (mirroring what a browser does on next paint, just
 * without the wait), and `beforeEach` stubs a non-zero `offsetWidth`/`offsetHeight` on every element,
 * together giving xyflow just enough real measurement to compute edge geometry under happy-dom.
 */

import type { PromptGraphModel } from '@prompt-studio/prompts';

// See the module doc above for why this fires synchronously (instead of being a pure no-op) and why
// `beforeEach` below also stubs `offsetWidth`/`offsetHeight` — both are needed for edges to render.
export class StubResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

export const SMALL_MODEL: PromptGraphModel = {
  nodes: [
    {
      id: 'root:support-triage',
      kind: 'root',
      label: 'support-triage',
      data: { kind: 'root', tree: buildEmptyTree('support-triage') },
    },
    {
      id: 'section:mission',
      kind: 'section',
      label: 'YOUR MISSION',
      parentId: 'root:support-triage',
      data: {
        kind: 'section',
        node: {
          id: 'mission',
          title: 'YOUR MISSION',
          delimiter: 'caps-label',
          depth: 1,
          text: 'Classify the customer message by category and urgency.',
          range: { start: 0, end: 0 },
          variables: ['company_name'],
          toolMentions: ['lookup_customer'],
          children: [],
        },
      },
    },
    {
      id: 'variable:company_name',
      kind: 'variable',
      label: 'company_name',
      data: { kind: 'variable', name: 'company_name' },
    },
    {
      id: 'tool:lookup_customer',
      kind: 'tool',
      label: 'lookup_customer',
      data: { kind: 'tool', name: 'lookup_customer' },
    },
  ],
  edges: [
    {
      id: 'contains:root:support-triage->section:mission',
      source: 'root:support-triage',
      target: 'section:mission',
      kind: 'contains',
    },
    {
      id: 'declares:section:mission->variable:company_name',
      source: 'section:mission',
      target: 'variable:company_name',
      kind: 'declares',
      label: '{{company_name}}',
    },
    {
      id: 'declares:section:mission->tool:lookup_customer',
      source: 'section:mission',
      target: 'tool:lookup_customer',
      kind: 'declares',
      label: 'lookup_customer',
    },
  ],
};

export const EMPTY_MODEL: PromptGraphModel = { nodes: [], edges: [] };

/**
 * Two section nodes (unlike `SMALL_MODEL`'s one), so the "Collapse all sections"/"Expand all
 * sections" `<ControlButton>` tests below can actually assert on EVERY section node, not just the
 * one `SMALL_MODEL` happens to have.
 */
export const TWO_SECTION_MODEL: PromptGraphModel = {
  nodes: [
    {
      id: 'root:support-triage',
      kind: 'root',
      label: 'support-triage',
      data: { kind: 'root', tree: buildEmptyTree('support-triage') },
    },
    {
      id: 'section:mission',
      kind: 'section',
      label: 'YOUR MISSION',
      parentId: 'root:support-triage',
      data: {
        kind: 'section',
        node: {
          id: 'mission',
          title: 'YOUR MISSION',
          delimiter: 'caps-label',
          depth: 1,
          text: 'Classify the customer message by category and urgency.',
          range: { start: 0, end: 0 },
          variables: [],
          toolMentions: [],
          children: [],
        },
      },
    },
    {
      id: 'section:process',
      kind: 'section',
      label: 'PROCESS',
      parentId: 'root:support-triage',
      data: {
        kind: 'section',
        node: {
          id: 'process',
          title: 'PROCESS',
          delimiter: 'caps-label',
          depth: 1,
          text: 'Propose one next step for the support team.',
          range: { start: 0, end: 0 },
          variables: [],
          toolMentions: [],
          children: [],
        },
      },
    },
  ],
  edges: [
    {
      id: 'contains:root:support-triage->section:mission',
      source: 'root:support-triage',
      target: 'section:mission',
      kind: 'contains',
    },
    {
      id: 'contains:root:support-triage->section:process',
      source: 'root:support-triage',
      target: 'section:process',
      kind: 'contains',
    },
  ],
};

function buildEmptyTree(key: string) {
  return { key, text: '', maxDepth: 0, children: [], tagClassifications: [], diagnostics: [] };
}

/**
 * Reads an edge's rendered `.react-flow__edge-path` inline style directly off the element's own
 * `CSSStyleDeclaration` (`.style.*`), NOT via `toHaveStyle`/`getComputedStyle` — happy-dom's CSS
 * engine doesn't resolve `var(--token)` custom-property references when computing style, so a
 * `getComputedStyle`-based assertion on `stroke: var(--primary)` silently fails even though the
 * correct inline `style` attribute (verified via `outerHTML`) is right there on the element. Reading
 * `.style.stroke` instead parses the inline style string verbatim, which happy-dom does correctly.
 */
export function edgeStroke(
  container: HTMLElement,
  edgeId: string,
): { stroke: string; strokeWidth: string; opacity: string } {
  const path = container.querySelector(`[data-testid="rf__edge-${edgeId}"] .react-flow__edge-path`) as SVGPathElement;
  return { stroke: path.style.stroke, strokeWidth: path.style.strokeWidth, opacity: path.style.opacity };
}

function buildSection(id: string, title: string, parentId: string) {
  return {
    id,
    kind: 'section' as const,
    label: title,
    parentId,
    data: {
      kind: 'section' as const,
      node: {
        id,
        title,
        delimiter: 'caps-label' as const,
        depth: 1,
        text: `Body for ${title}.`,
        range: { start: 0, end: 0 },
        variables: [],
        toolMentions: [],
        children: [],
      },
    },
  };
}

/**
 * A depth-2 chain (root → parent → child) PLUS an unrelated sibling section directly under root, so
 * the ancestor-path-highlight tests below can assert THREE distinct outcomes at once: the selected
 * node's own ancestors light up as on-path, an unrelated sibling does not, and only the two edges on
 * the actual path get the stronger stroke (the sibling's own `contains` edge gets dimmed instead).
 */
export const NESTED_MODEL: PromptGraphModel = {
  nodes: [
    {
      id: 'root:support-triage',
      kind: 'root',
      label: 'support-triage',
      data: { kind: 'root', tree: buildEmptyTree('support-triage') },
    },
    buildSection('section:parent', 'PARENT SECTION', 'root:support-triage'),
    buildSection('section:child', 'CHILD SECTION', 'section:parent'),
    buildSection('section:sibling', 'SIBLING SECTION', 'root:support-triage'),
  ],
  edges: [
    { id: 'contains:root->parent', source: 'root:support-triage', target: 'section:parent', kind: 'contains' },
    { id: 'contains:parent->child', source: 'section:parent', target: 'section:child', kind: 'contains' },
    { id: 'contains:root->sibling', source: 'root:support-triage', target: 'section:sibling', kind: 'contains' },
  ],
};
