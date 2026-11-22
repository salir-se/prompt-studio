/**
 * FragmentNode stories.
 *
 * `<FragmentNode>` renders one parsed prompt section (a `PromptTreeNode`)
 * as a standalone, read-only card. It has no graph dependency of its own —
 * `PromptGraphCanvas` wraps it for the `'section'` node type, but every
 * story here mounts it directly with hand-built props, matching the
 * component's "pure, props-only" contract.
 *
 * No meta-level decorator: CSF story-level decorators NEST INSIDE meta
 * decorators, they never replace them, so a meta-level width constraint would
 * still squeeze `AllStatesGallery`'s multi-column grid down to that same
 * width. Instead, every single-card story applies its own `narrow` decorator
 * (`360px`, roughly `LAYOUT_COLUMN_WIDTH` minus the canvas gutter) so it
 * renders at the width the card actually occupies inside `PromptGraphCanvas`,
 * while `AllStatesGallery` applies its own `wide` decorator sized for its grid.
 */

import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { type FragmentBodyMode, FragmentNode, type FragmentNodeProps } from './FragmentNode';

const meta: Meta<typeof FragmentNode> = {
  component: FragmentNode,
  title: 'Prompts/PromptGraphUi/FragmentNode',
};
export default meta;

type Story = StoryObj<typeof FragmentNode>;

/** Fixed-width wrapper for every single-card story — matches the column width the card actually occupies
 *  inside `PromptGraphCanvas`, rather than stretching to the Storybook canvas's full width. */
const narrow: Decorator = (Story) => (
  <div className="w-[360px] bg-background p-4">
    <Story />
  </div>
);

const BASE_ARGS = {
  title: 'YOUR MISSION',
  delimiter: 'caps-label' as const,
  depth: 1,
  text: 'Find companies with delegation-ready hiring signals. Score each signal 0-100 based on how confidently the company would accept an outstaffed team right now.',
  variables: ['icp', 'persona'],
  toolMentions: ['web_search'],
};

/** `'caps-label'` dialect — the dominant, load-bearing convention across today's prompts (e.g. `YOUR MISSION:`). */
export const CapsLabel: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS },
};

/** THE named regression anchor for `FragmentNode`'s visual baseline. Same args as `CapsLabel` (the
 *  dominant, load-bearing dialect), but kept under a stable `Default` name so visual-regression tooling
 *  and reviewers always have one predictable story to diff against, independent of which dialect happens
 *  to be dominant. `CapsLabel` stays as the story that documents the dialect explicitly by name. */
export const Default: Story = {
  decorators: [narrow],
  args: { ...CapsLabel.args },
};

/** `'atx-heading'` dialect — the markdown `#`/`##`/`###` style ADR-200 migrates prompts TO. Zero occurrences exist
 *  in today's prompt sources, so this story is what the future looks like, not a snapshot of production text. */
export const AtxHeading: Story = {
  decorators: [narrow],
  args: {
    ...BASE_ARGS,
    title: 'Search Strategy',
    delimiter: 'atx-heading',
    depth: 2,
    headingLevel: 4,
    text: 'Query job boards, funding announcements, and tech news for companies actively hiring 3+ developers, mentioning outsourcing or staff augmentation, or showing urgency language (ASAP, immediate start, Q2 deadline).',
    variables: ['icp'],
    toolMentions: ['web_search', 'check_exists'],
  },
};

/** `'xml-tag'` dialect — a balanced block-level tag pair such as `<inbound_email>...</inbound_email>`. */
export const XmlTag: Story = {
  decorators: [narrow],
  args: {
    ...BASE_ARGS,
    title: 'inbound_email',
    delimiter: 'xml-tag',
    depth: 1,
    text: 'Subject: Re: Your outreach\n\nThanks for reaching out — we are indeed scaling our engineering team this quarter and would like to learn more about your outstaffing model.',
    variables: [],
    toolMentions: ['save_contact'],
  },
};

/** Selected state — `aria-current="true"` and the `ring-2 ring-ring` selection outline, as set by a containing
 *  canvas/list when this node is the current selection. */
export const Selected: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, selected: true },
};

/** First source section: text plus a violet leading edge, not colour alone. */
export const OpeningAnchor: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, promptAnchor: 'opening' },
};

/** Last source section: text plus a sky trailing edge, not colour alone. */
export const ClosingAnchor: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, title: 'OUTPUT CONTRACT', promptAnchor: 'closing' },
};

/** A one-section prompt is both the opening and closing anchor. */
export const OpeningAndClosingAnchor: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, promptAnchor: 'both' },
};

/** The structure-action toolbar (ADR-202 §3 — add/remove/re-order as text edits): renders ONLY on a
 *  selected card, one icon button per provided callback, between the header and the body. Verifies
 *  every button is reachable by its accessible name. */
export const SelectedWithStructureActions: Story = {
  decorators: [narrow],
  args: {
    ...BASE_ARGS,
    selected: true,
    sectionActions: {
      onAddSiblingSection: fn(),
      onAddChildSection: fn(),
      onRemoveSection: fn(),
      onMoveUp: fn(),
      onMoveDown: fn(),
    },
  },
  play: async ({ canvas }) => {
    const toolbar = within(await canvas.findByTestId('fragment-node-actions'));
    for (const name of [
      'Move section up',
      'Move section down',
      'Add section after',
      'Add sub-section',
      'Remove section',
    ]) {
      await expect(toolbar.getByRole('button', { name })).toBeVisible();
    }
  },
};

/** `onPath: true` — the subtler `ring-1 ring-ring/50` treatment `PromptGraphCanvas` applies to every
 *  ancestor of a selected node (see `selection-path.ts`'s `selectionPath`), distinct from both the
 *  idle (no ring) and `Selected` (`ring-2 ring-ring`) states. */
export const OnPath: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, onPath: true },
};

/** Empty `variables` and `toolMentions` — proves the chip area collapses cleanly (the whole wrapping `<div>` is
 *  conditionally omitted) rather than leaving a gap where empty "Variables"/"Tools" rows would otherwise sit. */
export const NoVariablesOrTools: Story = {
  decorators: [narrow],
  args: {
    ...BASE_ARGS,
    title: 'Tone & Voice',
    text: 'Write in a warm, direct, consultative tone. Avoid corporate jargon and superlatives. Keep sentences short.',
    variables: [],
    toolMentions: [],
  },
};

/** 10 variables + 7 tool mentions — exposes chip wrapping across multiple lines and any whitespace accumulation
 *  between the two `ChipList`s once both wrap. */
export const ManyVariablesAndTools: Story = {
  decorators: [narrow],
  args: {
    ...BASE_ARGS,
    title: 'Scoring Rubric',
    text: 'Assign a delegation readiness score from 0-100 based on volume of open positions, urgency indicators, growth trajectory, funding stage, tech-stack alignment, and geographic/timezone compatibility.',
    variables: [
      'company_name',
      'icp',
      'persona',
      'signal_score',
      'industry',
      'headcount',
      'funding_stage',
      'tech_stack',
      'region',
      'urgency_level',
    ],
    toolMentions: [
      'web_search',
      'check_exists',
      'save_lead',
      'guess_email',
      'verify_email',
      'save_contact',
      'draft_email',
    ],
  },
};

const LONG_BODY_TEXT = Array.from(
  { length: 320 },
  (_, i) =>
    `Line ${i + 1}: verifying that the body scroll region clamps at max-h-40 instead of growing the card, ` +
    'and that a long section never blows out the surrounding canvas layout.',
).join('\n');

/** 320-line body (~30k characters) — proves the `max-h-40 overflow-y-auto` scroll cap on the `<pre>` holds and the
 *  card itself stays a fixed, predictable height regardless of section length. */
export const LongBody: Story = {
  decorators: [narrow],
  args: {
    ...BASE_ARGS,
    title: 'Detailed Methodology',
    text: LONG_BODY_TEXT,
  },
};

/** Empty body text — the `<pre>` renders with no content; confirms the card doesn't collapse or leave a broken
 *  empty-string artifact where the scroll region sits. */
export const EmptyBody: Story = {
  decorators: [narrow],
  args: {
    ...BASE_ARGS,
    title: 'Placeholder Section',
    text: '',
    variables: [],
    toolMentions: [],
  },
};

/** A very long, unbroken (no whitespace) title — exposes whether the header row's `truncate` class actually
 *  clips it with an ellipsis, or whether it overflows into the delimiter badge next to it. */
export const LongTitleNoSpaces: Story = {
  decorators: [narrow],
  args: {
    ...BASE_ARGS,
    title:
      'THIS_IS_AN_EXTREMELY_LONG_UNBROKEN_SECTION_TITLE_WITH_NO_WHITESPACE_ANYWHERE_FOR_THE_BROWSER_TO_WRAP_ON_SO_IT_MUST_EITHER_OVERFLOW_THE_CARD_HEADER_OR_GET_TRUNCATED_BY_THE_TRUNCATE_CLASS_DEPENDING_ON_HOW_THE_COMPONENT_ACTUALLY_HANDLES_IT',
  },
};

// ── fixedSize — the 360x220 canvas card variant ─────────────────────────────

/** `fixedSize: true` with normal content — the exact card `PromptGraphCanvas`'s section node type renders,
 *  at the fixed 360x220 footprint `layout.ts`'s grid is sized around, instead of this component's default
 *  fluid-width/content-height standalone behaviour. */
export const FixedSize: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, fixedSize: true },
};

/** `fixedSize` combined with `selected` — proves the two states compose (fixed footprint + selection ring)
 *  rather than one clobbering the other, matching how the canvas actually sets both props together. */
export const FixedSizeSelected: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, fixedSize: true, selected: true },
};

/** `fixedSize: true` with a long body AND 10+ variables + 7 tools at once — proves the internal clamps
 *  (`max-h-24` body, `max-h-16 overflow-y-auto` chip area) actually hold at the 220px fixed height under
 *  worst-case content, so nothing escapes the card the way it could if only one dimension were stressed. */
export const FixedSizeOverflow: Story = {
  decorators: [narrow],
  args: {
    ...BASE_ARGS,
    title: 'Scoring Rubric',
    fixedSize: true,
    text: LONG_BODY_TEXT,
    variables: [
      'company_name',
      'icp',
      'persona',
      'signal_score',
      'industry',
      'headcount',
      'funding_stage',
      'tech_stack',
      'region',
      'urgency_level',
    ],
    toolMentions: [
      'web_search',
      'check_exists',
      'save_lead',
      'guess_email',
      'verify_email',
      'save_contact',
      'draft_email',
    ],
  },
};

/** `xml-tag` dialect combined with `selected` — proves dialect and selection states compose independently:
 *  the delimiter badge still reads `xml-tag` while the selection ring is also applied. */
export const XmlTagSelected: Story = {
  decorators: [narrow],
  args: { ...XmlTag.args, selected: true },
};

// ── Verification states (ADR-202 Stage D: border treatment + finding-count chip) ──
//
// One story per `PromptVerificationState`, all five — deterministic-only runs can only produce
// valid/warning/invalid today, but `verified` (LLM pass green) and `degraded` (verifier unavailable)
// become reachable in a later stage, so the card must already render every state correctly.

/** `'valid'` — deliberately indistinguishable from an unverified card: default `border-border`, no chip
 *  (0 findings). Only the accessible label / `data-verification-state` betray that verification ran. */
export const VerificationValid: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, verification: { state: 'valid', findingCount: 0 } },
};

/** `'verified'` — LLM semantic pass green: emerald border (light + dark paired classes), no findings. */
export const VerificationVerified: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, verification: { state: 'verified', findingCount: 0 } },
};

/** `'warning'` — amber border plus a plural "2 findings" chip in the header (its `title` names the state). */
export const VerificationWarning: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, verification: { state: 'warning', findingCount: 2 } },
};

/** `'invalid'` — destructive-token red border plus a "3 findings" chip. */
export const VerificationInvalid: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, verification: { state: 'invalid', findingCount: 3 } },
};

/** `'degraded'` — verifier unavailable: dashed muted border, no findings (nothing was checked, so a
 *  finding count would be a lie — absence of the chip is the honest rendering). */
export const VerificationDegraded: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, verification: { state: 'degraded', findingCount: 0 } },
};

/** `collapsed` + `'invalid'` — the one-line card still answers "is this section OK": the red border and
 *  finding chip both survive collapse, so a fully-collapsed graph remains a readable verification map. */
export const VerificationCollapsedInvalid: Story = {
  decorators: [narrow],
  args: {
    ...BASE_ARGS,
    collapsed: true,
    onToggleCollapse: () => {},
    verification: { state: 'invalid', findingCount: 2 },
  },
};

/** `selected` + `'warning'` — proves the selection ring composes ON TOP of a state border (ring and
 *  border are distinct utilities) instead of either clobbering the other; also shows the singular
 *  "1 finding" chip label. */
export const VerificationSelectedWarning: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, selected: true, verification: { state: 'warning', findingCount: 1 } },
};

// ── Interaction affordances: edit / collapse / raw-vs-rendered body ────────

/** `onEditRequest` provided — renders the ghost pencil icon button (`aria-label="Edit section"`) in the
 *  header row. This story only proves the affordance renders (no dialog: that's a concurrent task's scope). */
export const WithEditButton: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, onEditRequest: () => {} },
};

/** `collapsed: true` — the one-line header-only form: title, delimiter badge, and any header buttons remain,
 *  but the body and chip area are both omitted and the card's height collapses to `auto` (~2.5rem). */
export const Collapsed: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, collapsed: true, onToggleCollapse: () => {} },
};

/** Stateful wrapper toggling `collapsed` via the card's own chevron button — proves the collapse/expand
 *  round-trip actually works end to end (not just each fixed state in isolation). */
function CollapsibleInteractiveDemo(): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  return <FragmentNode {...BASE_ARGS} collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} />;
}

export const CollapsibleInteractive: Story = {
  decorators: [narrow],
  render: () => <CollapsibleInteractiveDemo />,
};

/** `bodyMode: 'rendered'` — the body renders through `@prompt-studio/help-system`'s `Markdown` instead of the raw
 *  `<pre>`, using Markdown syntax (bold, a list) so the rendering is visibly distinct from raw text. */
export const RenderedBody: Story = {
  decorators: [narrow],
  args: {
    ...BASE_ARGS,
    title: 'Scoring Rubric',
    text: 'Score each signal **0-100** based on:\n\n- volume of open positions\n- urgency indicators\n- funding stage',
    bodyMode: 'rendered' as FragmentBodyMode,
  },
};

/** Stateful wrapper toggling `bodyMode` via the card's own raw/rendered toggle — proves the mode switch
 *  round-trips through the same body text rather than only rendering one fixed mode. */
function BodyModeInteractiveDemo(): React.JSX.Element {
  const [bodyMode, setBodyMode] = useState<FragmentBodyMode>('raw');
  return (
    <FragmentNode
      {...BASE_ARGS}
      text={RenderedBody.args?.text ?? BASE_ARGS.text}
      bodyMode={bodyMode}
      onBodyModeChange={setBodyMode}
    />
  );
}

export const BodyModeInteractive: Story = {
  decorators: [narrow],
  render: () => <BodyModeInteractiveDemo />,
};

// ── Interaction tests: focus, keyboard activation, round-trip toggles ──────

/** Keyboard focus + activation on the edit pencil button — tabs into the only tabbable control this
 *  story renders (no collapse/body-mode toggles are wired here), asserts the browser's native focus
 *  lands on it, then activates it with `Enter` (a native `<button>`'s built-in keyboard-activation key)
 *  and asserts `onEditRequest` actually fires. Proves the affordance is reachable and operable from the
 *  keyboard, not just clickable. */
export const EditButtonFocusVisible: Story = {
  decorators: [narrow],
  args: { ...BASE_ARGS, onEditRequest: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const editButton = canvas.getByRole('button', { name: 'Edit section' });

    await userEvent.tab();
    await expect(editButton).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    await expect(args.onEditRequest).toHaveBeenCalledTimes(1);
  },
};

/** Stateful wrapper (reuses `CollapsibleInteractiveDemo`, the same demo `CollapsibleInteractive` renders)
 *  whose `play` drives the chevron by both mouse and keyboard: clicking it flips `aria-expanded` from
 *  `true` to `false` and the body/chip content disappears (the header row alone remains); pressing
 *  `Enter` on the now-focused, relabelled button flips it back and the content reappears. Asserts the
 *  round trip in both directions, not just one. */
export const CollapseToggleKeyboard: Story = {
  decorators: [narrow],
  render: () => <CollapsibleInteractiveDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const collapseButton = canvas.getByRole('button', { name: 'Collapse section' });

    await expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByLabelText('Variables')).toBeInTheDocument();

    await userEvent.click(collapseButton);
    const expandButton = canvas.getByRole('button', { name: 'Expand section' });
    await expect(expandButton).toHaveAttribute('aria-expanded', 'false');
    await expect(canvas.queryByLabelText('Variables')).not.toBeInTheDocument();

    expandButton.focus();
    await userEvent.keyboard('{Enter}');
    const collapseButtonAgain = canvas.getByRole('button', { name: 'Collapse section' });
    await expect(collapseButtonAgain).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByLabelText('Variables')).toBeInTheDocument();
  },
};

/** `play`-driven round trip on the raw/rendered body toggle (reuses `BodyModeInteractiveDemo`, the same
 *  demo `BodyModeInteractive` renders): clicking "Rendered" replaces the raw `<pre>` — whose literal
 *  Markdown source (`**0-100**`) is visible text in raw mode — with the rendered Markdown container,
 *  where that literal asterisk text is gone because it has been rendered as bold; clicking "Raw" switches
 *  back. Asserts observable output (visible text + the rendered container), never the toggle's internal
 *  state. */
export const BodyModeToggle: Story = {
  decorators: [narrow],
  render: () => <BodyModeInteractiveDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText(/\*\*0-100\*\*/)).toBeInTheDocument();
    await expect(canvas.queryByTestId('fragment-node-body-rendered')).not.toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: 'Rendered' }));
    await expect(canvas.getByTestId('fragment-node-body-rendered')).toBeInTheDocument();
    await expect(canvas.queryByText(/\*\*0-100\*\*/)).not.toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: 'Raw' }));
    await expect(canvas.getByText(/\*\*0-100\*\*/)).toBeInTheDocument();
    await expect(canvas.queryByTestId('fragment-node-body-rendered')).not.toBeInTheDocument();
  },
};

// ── AllStatesGallery — one screenshot covering every state ──────────────────

/** A single labelled grid cell: renders `children` under a small muted caption naming the state, so the
 *  gallery below reads top-to-bottom as one annotated screenshot rather than an unlabelled wall of cards. */
function GalleryCell({ caption, children }: { caption: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{caption}</span>
      {children}
    </div>
  );
}

/** Wide, non-narrow wrapper for the gallery grid — deliberately its own decorator rather than reusing
 *  `narrow`, since the grid needs room for three 380px columns. `overflow-x-auto` keeps the grid from
 *  wrapping/clipping if the Storybook canvas viewport is ever narrower than the grid's natural width. */
const wide: Decorator = (Story) => (
  <div className="overflow-x-auto bg-background p-4">
    <Story />
  </div>
);

/** Every meaningful `FragmentNode` state in one grid — a single story a reviewer can screenshot and read
 *  top-to-bottom, rather than clicking through 14 separate stories to visually verify the set. Uses its own
 *  `wide` decorator (never `narrow` — story-level decorators nest inside meta-level ones, they don't replace
 *  them, so reusing a 360px decorator here would squeeze every column down to 360px total). Explicit
 *  `repeat(3, 380px)` columns (not `1fr`/responsive breakpoints) so every column is wide enough to hold a
 *  fixed 360x220 card without clipping it against the next cell, and a fluid card renders at its natural
 *  ~360px width rather than stretching to fill an arbitrarily wide `1fr` track.
 *
 *  This is a REVIEW ARTIFACT, not a regression baseline: with a dozen states composited into one image, a
 *  one-pixel change in ANY single card diffs the whole screenshot, so a failure here can never be localised
 *  to the state that actually changed. `tags: ['!test']` excludes it from test/baseline pipelines —
 *  `Default` and the other individual per-state stories above (each independently diffable) are the real
 *  regression anchors; use this gallery for human visual review only. */
export const AllStatesGallery: Story = {
  decorators: [wide],
  tags: ['!test'],
  render: () => (
    <div className="grid grid-cols-[repeat(3,380px)] gap-4">
      <GalleryCell caption="caps-label dialect">
        <FragmentNode {...BASE_ARGS} />
      </GalleryCell>
      <GalleryCell caption="atx-heading dialect">
        <FragmentNode {...(AtxHeading.args as FragmentNodeProps)} />
      </GalleryCell>
      <GalleryCell caption="xml-tag dialect">
        <FragmentNode {...(XmlTag.args as FragmentNodeProps)} />
      </GalleryCell>
      <GalleryCell caption="selected">
        <FragmentNode {...BASE_ARGS} selected />
      </GalleryCell>
      <GalleryCell caption="empty chips (no variables/tools)">
        <FragmentNode {...(NoVariablesOrTools.args as FragmentNodeProps)} />
      </GalleryCell>
      <GalleryCell caption="many variables and tools">
        <FragmentNode {...(ManyVariablesAndTools.args as FragmentNodeProps)} />
      </GalleryCell>
      <GalleryCell caption="empty body">
        <FragmentNode {...(EmptyBody.args as FragmentNodeProps)} />
      </GalleryCell>
      <GalleryCell caption="fixedSize (360x220 canvas card)">
        <FragmentNode {...BASE_ARGS} fixedSize />
      </GalleryCell>
      <GalleryCell caption="fixedSize + selected">
        <FragmentNode {...BASE_ARGS} fixedSize selected />
      </GalleryCell>
      <GalleryCell caption="fixedSize + overflow (long body + many chips)">
        <FragmentNode {...(FixedSizeOverflow.args as FragmentNodeProps)} />
      </GalleryCell>
      <GalleryCell caption="with edit button">
        <FragmentNode {...(WithEditButton.args as FragmentNodeProps)} />
      </GalleryCell>
      <GalleryCell caption="collapsed (one-line)">
        <FragmentNode {...(Collapsed.args as FragmentNodeProps)} />
      </GalleryCell>
      <GalleryCell caption="verification: valid (default border, no chip)">
        <FragmentNode {...(VerificationValid.args as FragmentNodeProps)} />
      </GalleryCell>
      <GalleryCell caption="verification: verified (emerald border)">
        <FragmentNode {...(VerificationVerified.args as FragmentNodeProps)} />
      </GalleryCell>
      <GalleryCell caption="verification: warning (amber border, 2 findings)">
        <FragmentNode {...(VerificationWarning.args as FragmentNodeProps)} />
      </GalleryCell>
      <GalleryCell caption="verification: invalid (destructive border, 3 findings)">
        <FragmentNode {...(VerificationInvalid.args as FragmentNodeProps)} />
      </GalleryCell>
      <GalleryCell caption="verification: degraded (dashed muted border)">
        <FragmentNode {...(VerificationDegraded.args as FragmentNodeProps)} />
      </GalleryCell>
      <GalleryCell caption="verification: selected + warning (ring over border)">
        <FragmentNode {...(VerificationSelectedWarning.args as FragmentNodeProps)} />
      </GalleryCell>
    </div>
  ),
};
