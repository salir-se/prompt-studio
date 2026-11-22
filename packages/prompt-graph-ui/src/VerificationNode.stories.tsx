/**
 * VerificationNode stories.
 *
 * `<VerificationNode>` renders one verification-principles projection — the
 * "verification principles node" the ADR-200 verification contracts (now
 * merged into `@prompt-studio/prompts`) describe: a state badge plus the semantic
 * principles and findings behind it. It has no graph dependency of its own
 * and performs no semantic review itself — every prop here is a hand-built
 * instance of the REAL `PromptVerificationPrinciple`/`PromptVerificationFinding`
 * shapes from `@prompt-studio/prompts`, not an invented parallel type.
 *
 * The component sets its own fixed 360px footprint (matching `FragmentNode`'s
 * `fixedSize` card width), so the decorator here only supplies background and
 * breathing-room padding rather than a width constraint of its own.
 */

import type { PromptVerificationFinding, PromptVerificationPrinciple } from '@prompt-studio/prompts';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { VerificationNode } from './VerificationNode';

const meta: Meta<typeof VerificationNode> = {
  component: VerificationNode,
  title: 'Prompts/PromptGraphUi/VerificationNode',
};
export default meta;

type Story = StoryObj<typeof VerificationNode>;

/** Fixed-footprint wrapper for every single-card story — the card itself is a fixed 360px width, so this
 *  decorator only adds background and padding, not a competing width constraint. */
const narrow: Decorator = (Story) => (
  <div className="w-fit bg-background p-4">
    <Story />
  </div>
);

const ALLOWED_CUSTOMIZATION = 'Wording may change while the prompt keeps its declared functional contract.';

/** Three realistic principles, in the same statement style as `semanticPrinciples()` in
 *  `packages/prompts/src/verification-profiles.ts` — two `platform`-owned (protected, read-only) plus one
 *  `configuration`-owned (workspace-tailorable), so both owner-chip tints appear in every story. */
const SCOUT_PRINCIPLES: readonly PromptVerificationPrinciple[] = [
  {
    id: 'semantic-mission',
    version: 1,
    owner: 'platform',
    statement: 'Find companies with delegation-ready hiring signals and score each 0-100.',
    severity: 'error',
    allowedCustomization: ALLOWED_CUSTOMIZATION,
    sectionIds: [],
  },
  {
    id: 'semantic-tools',
    version: 1,
    owner: 'platform',
    statement: 'Preserve load-bearing tool usage, ordering, and preconditions.',
    severity: 'error',
    allowedCustomization: ALLOWED_CUSTOMIZATION,
    sectionIds: [],
  },
  {
    id: 'workspace-tone',
    version: 1,
    owner: 'configuration',
    statement: "Match the workspace's configured outreach tone guidance.",
    severity: 'warning',
    allowedCustomization: 'Tone guidance may be tailored per workspace.',
    sectionIds: [],
  },
];

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

const INVALID_FINDING: PromptVerificationFinding = {
  profile: { id: 'scout', version: 1 },
  scope: 'section',
  sectionId: 'scoring-rubric',
  severity: 'error',
  message: 'Removed required placeholder {{icp}} referenced by the scoring rubric.',
  source: 'deterministic',
  ruleId: 'required-placeholder:icp',
  enforcement: 'activation',
};

/** `valid` — deterministic checks pass, semantic review has not run yet (`semanticStatus: 'not-run'`). */
export const Valid: Story = {
  decorators: [narrow],
  args: {
    title: 'scout',
    state: 'valid',
    principles: SCOUT_PRINCIPLES,
  },
};

/** THE named regression anchor for `VerificationNode`'s visual baseline. Same args as `Valid` — the
 *  starting state before semantic review runs is the dominant case a reviewer sees first. */
export const Default: Story = {
  decorators: [narrow],
  args: { ...Valid.args },
};

/** `verified` — semantic review ran and passed (`semanticStatus: 'passed'`, no findings). */
export const Verified: Story = {
  decorators: [narrow],
  args: {
    title: 'scout',
    state: 'verified',
    principles: SCOUT_PRINCIPLES,
  },
};

/** `warning` — a semantic finding needs acknowledgement (per `derivePromptVerificationState`, a `warning`-
 *  or `semantic`-sourced finding always yields this state, short of a hard deterministic `invalid`). */
export const Warning: Story = {
  decorators: [narrow],
  args: {
    title: 'scout',
    state: 'warning',
    principles: SCOUT_PRINCIPLES,
    findings: [WARNING_FINDING],
  },
};

/** `invalid` — a deterministic, `activation`-enforced error finding (a removed required placeholder),
 *  the one class of finding `derivePromptVerificationState` treats as a hard failure. */
export const Invalid: Story = {
  decorators: [narrow],
  args: {
    title: 'scout',
    state: 'invalid',
    principles: SCOUT_PRINCIPLES,
    findings: [INVALID_FINDING],
  },
};

/** `degraded` — semantic review was unavailable (no provider key, exhausted budget, or a provider error
 *  after one retry per ADR-151/ADR-202 §8's "absence degrades, never blocks" posture). Deterministic
 *  checks still passed, so no findings accompany this state. */
export const Degraded: Story = {
  decorators: [narrow],
  args: {
    title: 'scout',
    state: 'degraded',
    principles: SCOUT_PRINCIPLES,
  },
};
