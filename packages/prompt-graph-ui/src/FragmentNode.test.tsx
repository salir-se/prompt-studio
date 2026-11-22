// @module-tag dom
/**
 * BDD tests for FragmentNode.
 *
 * Behaviour contracts:
 *  - Renders the section title as an accessible heading.
 *  - Shows a delimiter-dialect badge matching `delimiter` ('caps-label' / 'atx-heading' / 'xml-tag').
 *  - Renders the body text verbatim.
 *  - Renders one chip per entry in `variables` and `toolMentions`.
 *  - Renders no chip list when `variables`/`toolMentions` are both empty.
 *  - Defaults the title heading to `h3` and honours an explicit `headingLevel`.
 *  - Exposes selection via `data-selected` / `aria-current`, never `aria-selected` on a bare card.
 *  - `fixedSize` defaults to `false` (fluid width, no fixed height); when `true`, the card takes a
 *    fixed 360x220 footprint instead.
 *  - `onEditRequest`/`onToggleCollapse`/`onBodyModeChange` are all optional and default-off: omitting
 *    them renders no affordance at all and reproduces the card's original output exactly.
 *  - `collapsed` renders a one-line header-only card, hiding body and chips.
 *  - `bodyMode` picks raw `<pre>` (default) vs rendered Markdown for the body region.
 *  - `verification` (ADR-202 Stage D) drives a per-state border treatment, a pluralized
 *    finding-count chip (absent at 0 findings), and a state-naming accessible label — all
 *    surviving `collapsed` mode and composing with the selection ring.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FragmentNode } from './FragmentNode';

describe('FragmentNode', () => {
  it.each(['raw', 'rendered'] as const)(
    'makes the %s instruction region reachable for keyboard scrolling',
    (bodyMode) => {
      render(
        <FragmentNode
          title="Mission"
          delimiter="atx-heading"
          depth={1}
          text="Read all the supplied instructions."
          variables={[]}
          toolMentions={[]}
          bodyMode={bodyMode}
        />,
      );
      expect(screen.getByRole('region', { name: 'Mission instructions' })).toHaveAttribute('tabindex', '0');
    },
  );
  it('renders the section title as a heading', () => {
    render(
      <FragmentNode
        title="Your Mission"
        delimiter="caps-label"
        depth={1}
        text="Find companies hiring for delegation-ready roles."
        variables={[]}
        toolMentions={[]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Your Mission' })).toBeInTheDocument();
  });

  it.each([
    ['caps-label', 'caps-label'],
    ['atx-heading', 'atx-heading'],
    ['xml-tag', 'xml-tag'],
  ] as const)('shows a %s delimiter badge', (delimiter, expectedLabel) => {
    render(
      <FragmentNode title="Section" delimiter={delimiter} depth={1} text="body" variables={[]} toolMentions={[]} />,
    );
    expect(screen.getByText(expectedLabel)).toBeInTheDocument();
  });

  it('renders the body text verbatim, preserving whitespace', () => {
    const text = 'line one\n  indented line two';
    render(
      <FragmentNode
        title="Search Strategy"
        delimiter="caps-label"
        depth={2}
        text={text}
        variables={[]}
        toolMentions={[]}
      />,
    );
    expect(screen.getByRole('region', { name: 'Search Strategy instructions' }).querySelector('pre')?.textContent).toBe(
      text,
    );
  });

  it('highlights variables, tool mentions, and XML tags inline in the raw body', () => {
    const { container } = render(
      <FragmentNode
        title="Mission"
        delimiter="caps-label"
        depth={1}
        text="Greet {{first_name}}, call web_search, honor <constraints>."
        variables={['first_name']}
        toolMentions={['web_search']}
      />,
    );

    const body = container.querySelector('pre') as HTMLElement;
    // Same token colour vocabulary as `HighlightedPromptText`/the app's `PromptHighlightedEditor`:
    // known variable = violet, tool = sky, tag = emerald.
    expect(within(body).getByText('{{first_name}}')).toHaveClass('text-violet-800');
    expect(within(body).getByText('web_search')).toHaveClass('text-sky-800');
    expect(within(body).getByText('<constraints>')).toHaveClass('text-emerald-800');
    // The partition reconstructs the body byte-for-byte — highlighting never alters the text.
    expect(body.textContent).toBe('Greet {{first_name}}, call web_search, honor <constraints>.');
  });

  it('renders the structure-action toolbar only while selected, and fires each callback', () => {
    const onMoveUp = vi.fn();
    const onRemoveSection = vi.fn();
    const props = {
      title: 'Mission',
      delimiter: 'caps-label' as const,
      depth: 1,
      text: 'body',
      variables: [],
      toolMentions: [],
      sectionActions: { onMoveUp, onRemoveSection },
    };

    const { rerender } = render(<FragmentNode {...props} />);
    expect(screen.queryByTestId('fragment-node-actions')).not.toBeInTheDocument();

    rerender(<FragmentNode {...props} selected />);
    const toolbar = screen.getByTestId('fragment-node-actions');
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Move section up' }));
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Remove section' }));
    expect(onMoveUp).toHaveBeenCalledTimes(1);
    expect(onRemoveSection).toHaveBeenCalledTimes(1);
    // Callbacks not provided render no button at all.
    expect(within(toolbar).queryByRole('button', { name: 'Add section after' })).not.toBeInTheDocument();
  });

  it('renders a chip for every variable', () => {
    render(
      <FragmentNode
        title="Greeting"
        delimiter="atx-heading"
        depth={1}
        text="Hello {{first_name}} from {{company_name}}."
        variables={['first_name', 'company_name']}
        toolMentions={[]}
      />,
    );
    expect(screen.getByText('first_name')).toBeInTheDocument();
    expect(screen.getByText('company_name')).toBeInTheDocument();
  });

  it('renders a chip for every tool mention', () => {
    render(
      <FragmentNode
        title="Tools"
        delimiter="xml-tag"
        depth={1}
        text="Use web_search then save_lead."
        variables={[]}
        toolMentions={['web_search', 'save_lead']}
      />,
    );
    // Scoped to the chip list items — the raw body now ALSO highlights each mention inline
    // (see the raw-body highlight test above), so a bare text query would match both.
    const chipTexts = screen.getAllByRole('listitem').map((chip) => chip.textContent);
    expect(chipTexts).toEqual(expect.arrayContaining(['web_search', 'save_lead']));
  });

  it('renders no chip section when variables and toolMentions are both empty', () => {
    render(
      <FragmentNode
        title="Plain Section"
        delimiter="caps-label"
        depth={1}
        text="Nothing to bind here."
        variables={[]}
        toolMentions={[]}
      />,
    );
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('marks the node selected via data-selected and aria-current when selected is true', () => {
    render(
      <FragmentNode
        title="Selected Section"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        selected
      />,
    );
    const card = screen.getByRole('article', { name: 'Selected Section' });
    expect(card).toHaveAttribute('data-selected', 'true');
    expect(card).toHaveAttribute('aria-current', 'true');
  });

  it('is not marked selected by default', () => {
    render(
      <FragmentNode
        title="Unselected Section"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
      />,
    );
    const card = screen.getByRole('article', { name: 'Unselected Section' });
    expect(card).toHaveAttribute('data-selected', 'false');
    expect(card).not.toHaveAttribute('aria-current');
  });

  // ── onPath (ancestor-path highlight) ─────────────────────────────────────

  it('is not marked on-path by default (onPath defaults to false)', () => {
    render(<FragmentNode title="Idle" delimiter="caps-label" depth={1} text="body" variables={[]} toolMentions={[]} />);
    const card = screen.getByRole('article', { name: 'Idle' });
    expect(card).toHaveAttribute('data-on-path', 'false');
    expect(card.className).not.toMatch(/ring-1/);
  });

  it('renders the subtler ring-1 ring-ring/50 treatment when onPath is true', () => {
    render(
      <FragmentNode
        title="On Path"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        onPath
      />,
    );
    const card = screen.getByRole('article', { name: 'On Path' });
    expect(card).toHaveAttribute('data-on-path', 'true');
    expect(card.className).toMatch(/ring-1 ring-ring\/50/);
    expect(card.className).not.toMatch(/ring-2/);
  });

  it('lets selected win over onPath when both are true (no on-path ring on the selected node itself)', () => {
    render(
      <FragmentNode
        title="Selected And On Path"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        selected
        onPath
      />,
    );
    const card = screen.getByRole('article', { name: 'Selected And On Path' });
    expect(card).toHaveAttribute('data-selected', 'true');
    expect(card).toHaveAttribute('data-on-path', 'false');
    expect(card.className).toMatch(/ring-2 ring-ring\b/);
    expect(card.className).not.toMatch(/ring-1/);
  });

  it('defaults the title heading to h3', () => {
    render(
      <FragmentNode
        title="Default Heading Level"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
      />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Default Heading Level' })).toBeInTheDocument();
  });

  it('does not apply a fixed-height class by default (fixedSize defaults to false)', () => {
    render(
      <FragmentNode
        title="Fluid Section"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
      />,
    );
    const card = screen.getByRole('article', { name: 'Fluid Section' });
    expect(card.className).not.toMatch(/\bh-\[220px\]/);
    expect(card.className).not.toMatch(/\bw-\[360px\]/);
  });

  it('applies the fixed 360x220 footprint when fixedSize is true', () => {
    render(
      <FragmentNode
        title="Fixed Section"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        fixedSize
      />,
    );
    const card = screen.getByRole('article', { name: 'Fixed Section' });
    expect(card.className).toMatch(/\bh-\[220px\]/);
    expect(card.className).toMatch(/\bw-\[360px\]/);
  });

  it('honours an explicit headingLevel', () => {
    render(
      <FragmentNode
        title="Explicit Heading Level"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        headingLevel={5}
      />,
    );
    expect(screen.getByRole('heading', { level: 5, name: 'Explicit Heading Level' })).toBeInTheDocument();
  });

  // ── onEditRequest ────────────────────────────────────────────────────────

  it('renders no edit button when onEditRequest is omitted (default-off)', () => {
    render(
      <FragmentNode title="No Edit" delimiter="caps-label" depth={1} text="body" variables={[]} toolMentions={[]} />,
    );
    expect(screen.queryByRole('button', { name: 'Edit section' })).not.toBeInTheDocument();
  });

  it('renders an edit button that fires onEditRequest when provided', () => {
    const onEditRequest = vi.fn();
    render(
      <FragmentNode
        title="Editable"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        onEditRequest={onEditRequest}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit section' }));
    expect(onEditRequest).toHaveBeenCalledTimes(1);
  });

  // ── collapsed / onToggleCollapse ─────────────────────────────────────────

  it('renders no collapse toggle when onToggleCollapse is omitted (default-off)', () => {
    render(
      <FragmentNode title="No Toggle" delimiter="caps-label" depth={1} text="body" variables={[]} toolMentions={[]} />,
    );
    expect(screen.queryByRole('button', { name: /collapse|expand/i })).not.toBeInTheDocument();
  });

  it('renders a collapse toggle with aria-expanded reflecting the expanded state and fires onToggleCollapse', () => {
    const onToggleCollapse = vi.fn();
    render(
      <FragmentNode
        title="Toggleable"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        onToggleCollapse={onToggleCollapse}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Collapse section' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it('reflects aria-expanded="false" and an "Expand section" label when collapsed is true', () => {
    render(
      <FragmentNode
        title="Collapsed Toggleable"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        collapsed
        onToggleCollapse={() => {}}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Expand section' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides the body and chip area when collapsed is true, keeping only the header row', () => {
    render(
      <FragmentNode
        title="Collapsed Section"
        delimiter="caps-label"
        depth={1}
        text="This body should not render."
        variables={['icp']}
        toolMentions={['web_search']}
        collapsed
      />,
    );
    expect(screen.getByRole('heading', { name: 'Collapsed Section' })).toBeInTheDocument();
    expect(screen.queryByText('This body should not render.')).not.toBeInTheDocument();
    expect(screen.queryByText('icp')).not.toBeInTheDocument();
    expect(screen.queryByText('web_search')).not.toBeInTheDocument();
  });

  it('does not apply the collapsed one-line height class by default (collapsed defaults to false)', () => {
    render(
      <FragmentNode title="Expanded" delimiter="caps-label" depth={1} text="body" variables={[]} toolMentions={[]} />,
    );
    const card = screen.getByRole('article', { name: 'Expanded' });
    expect(card.className).not.toMatch(/min-h-\[2\.5rem\]/);
    expect(screen.queryByText('body')).toBeInTheDocument();
  });

  // ── bodyMode / onBodyModeChange ──────────────────────────────────────────

  it('renders the body as a <pre> by default (bodyMode defaults to raw)', () => {
    render(
      <FragmentNode
        title="Raw Body"
        delimiter="caps-label"
        depth={1}
        text="**not bold**"
        variables={[]}
        toolMentions={[]}
      />,
    );
    expect(screen.getByText('**not bold**').tagName).toBe('PRE');
    expect(screen.queryByTestId('fragment-node-body-rendered')).not.toBeInTheDocument();
  });

  it('renders the body as Markdown, not a <pre>, when bodyMode is "rendered"', () => {
    render(
      <FragmentNode
        title="Rendered Body"
        delimiter="caps-label"
        depth={1}
        text="This is **bold** text."
        variables={[]}
        toolMentions={[]}
        bodyMode="rendered"
      />,
    );
    expect(screen.getByRole('article', { name: 'Rendered Body' }).querySelector('pre')).toBeNull();
    expect(screen.getByTestId('fragment-node-body-rendered')).toBeInTheDocument();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('renders no raw/rendered toggle when onBodyModeChange is omitted (default-off)', () => {
    render(
      <FragmentNode title="No Toggle" delimiter="caps-label" depth={1} text="body" variables={[]} toolMentions={[]} />,
    );
    expect(screen.queryByRole('group', { name: 'Body display mode' })).not.toBeInTheDocument();
  });

  it('renders a raw/rendered toggle reflecting bodyMode and fires onBodyModeChange on click', () => {
    const onBodyModeChange = vi.fn();
    render(
      <FragmentNode
        title="Mode Toggle"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        bodyMode="raw"
        onBodyModeChange={onBodyModeChange}
      />,
    );
    expect(screen.getByRole('button', { name: 'Raw' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Rendered' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Rendered' }));
    expect(onBodyModeChange).toHaveBeenCalledWith('rendered');
  });

  // ── fillContainer ────────────────────────────────────────────────────────

  it('does not apply h-full/w-full-fill classes by default (fillContainer defaults to false)', () => {
    render(
      <FragmentNode title="No Fill" delimiter="caps-label" depth={1} text="body" variables={[]} toolMentions={[]} />,
    );
    const card = screen.getByRole('article', { name: 'No Fill' });
    expect(card.className).not.toMatch(/\bh-full\b/);
  });

  it('applies h-full/w-full and takes precedence over fixedSize when fillContainer is true', () => {
    render(
      <FragmentNode
        title="Filled"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        fixedSize
        fillContainer
      />,
    );
    const card = screen.getByRole('article', { name: 'Filled' });
    expect(card.className).toMatch(/\bh-full\b/);
    expect(card.className).toMatch(/\bw-full\b/);
    expect(card.className).not.toMatch(/\bh-\[220px\]/);
    expect(card.className).not.toMatch(/\bw-\[360px\]/);
  });
});
