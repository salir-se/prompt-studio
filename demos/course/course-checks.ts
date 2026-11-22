import { expect, type Locator, type Page } from '@playwright/test';
import { orderJson } from '../helpers/demo-orders-mcp';
import { type Cursor, typeInto } from './course-session';
import { DEMO_MESSAGES, FINISHED_DESIGN, PROJECT_JSON } from './course-texts';

/**
 * The checks and the test suite of episode 5, shared with the off-camera replay that episode 6 starts from: the
 * agent's check proposals, the seven edge-case-first test cases, and the UI steps that accept and fill them.
 */
const COMPANY = PROJECT_JSON.variables[1].sample;

export interface SuiteCase {
  name: string;
  message: string;
  mock?: string;
  include: string;
  exclude: string;
}
export const CASES: SuiteCase[] = [
  { name: 'No order ID', message: DEMO_MESSAGES.noId, include: 'ask_for_order_id', exclude: 'escalate' },
  {
    name: 'Not found',
    message: DEMO_MESSAGES.notFound,
    mock: orderJson('ORD-99999'),
    include: 'ask_for_order_id',
    exclude: 'shipped',
  },
  { name: 'Two orders', message: DEMO_MESSAGES.twoOrders, include: 'ask_for_order_id', exclude: 'PG-55821' },
  {
    name: 'Injection attempt',
    message: DEMO_MESSAGES.injection,
    mock: orderJson('ORD-10423'),
    include: '"next_action":"none"',
    exclude: 'refunded',
  },
  {
    name: 'Angry, wants refund',
    message: DEMO_MESSAGES.angry,
    mock: orderJson('ORD-10571'),
    include: 'escalate',
    exclude: 'refunded',
  },
  {
    name: 'Shipped',
    message: DEMO_MESSAGES.shipped,
    mock: orderJson('ORD-10423'),
    include: 'PG-55821',
    exclude: 'escalate',
  },
  {
    name: 'Delayed',
    message: DEMO_MESSAGES.delayed,
    mock: orderJson('ORD-10571'),
    include: '26 November',
    exclude: 'escalate',
  },
];

/** A finished AI criterion's statement, by id. */
export function principle(id: string): string {
  for (const profile of FINISHED_DESIGN.verificationProfiles)
    for (const item of profile.principles) if (item.id === id) return item.statement;
  throw new Error(`No criterion ${id}`);
}

const rule = (sectionId: string, check: Record<string, unknown>) => ({
  sectionId,
  kind: 'rule',
  rule: { ...check, severity: 'error', enforcement: 'edit' },
  label: `${sectionId} ${check.kind}${check.name ? ` ${check.name}` : ''}${check.literal ? ` ${check.literal}` : ''}`,
});
const criterion = (sectionId: string | undefined, id: string) => ({
  ...(sectionId ? { sectionId } : {}),
  kind: 'criterion',
  statement: principle(id),
  severity: 'error',
  label: `${sectionId ?? 'whole prompt'} criterion ${id}`,
});
export const PROPOSALS = [
  rule('tool_use', { kind: 'required-tool', name: 'lookup_order' }),
  rule('tool_use', { kind: 'required-output-literal', literal: 'ask_for_order_id' }),
  rule('output_format', { kind: 'required-output-literal', literal: 'reply' }),
  rule('output_format', { kind: 'required-output-literal', literal: 'next_action' }),
  rule('output_format', { kind: 'required-output-literal', literal: 'order_id' }),
  rule('output_format', { kind: 'valid-json-output' }),
  criterion('rules', 'facts-from-tool-only'),
  criterion('rules', 'no-unreturned-promises'),
  criterion('tool_use', 'no-guessing-between-orders'),
  criterion(undefined, 'escalation-triggers'),
  criterion(undefined, 'examples-cover-edge-cases'),
];

/** Accepts every pending proposal in the Verify panel, one scope at a time. `click` is the cursor or a plain click. */
export async function acceptProposals(page: Page, click: (target: Locator) => Promise<void>): Promise<void> {
  const verify = page.getByRole('complementary', { name: /^Verify/ });
  const scope = verify.getByRole('combobox', { name: 'Verification section' });
  const proposed = verify.getByRole('region', { name: 'Proposed checks' });
  const accept = proposed.getByRole('button', { name: 'Accept proposal' });
  for (const label of ['Rules', 'Tool use', 'Output format', 'Whole prompt']) {
    await click(scope);
    await scope.selectOption({ label });
    await expect(accept.first()).toBeVisible();
    await proposed.first().scrollIntoViewIfNeeded();
    for (let count = await accept.count(); count > 0; count -= 1) {
      await click(accept.first());
      await expect(accept).toHaveCount(count - 1);
    }
  }
}

/** Fills the expanded test case. The first two are typed on camera; the rest are filled quickly. */
export async function fillCase(
  page: Page,
  cursor: Cursor | undefined,
  suites: Locator,
  item: SuiteCase,
  onCamera: boolean,
) {
  const set = async (field: Locator, value: string) => {
    if (onCamera && cursor) await typeInto(cursor, field, value, 12);
    else await field.fill(value);
  };
  await set(suites.getByRole('textbox', { name: 'Test name', exact: true }), item.name);
  await set(suites.getByRole('textbox', { name: 'company_name', exact: true }), COMPANY);
  await set(suites.getByRole('textbox', { name: 'customer_message', exact: true }), item.message);
  await set(suites.getByRole('textbox', { name: /^Must include/ }), item.include);
  await set(suites.getByRole('textbox', { name: /^Must exclude/ }), item.exclude);
  const json = suites.getByRole('checkbox', { name: 'Require valid JSON' });
  if (onCamera && cursor) await cursor.click(json);
  else await json.check();
  if (!item.mock) return;
  const summary = suites.locator('summary:visible').filter({ hasText: 'Tool responses for this test' });
  if (onCamera && cursor) await cursor.click(summary);
  else await summary.click();
  const override = suites.getByRole('checkbox', { name: 'Override the shared tool responses' });
  await override.check();
  const execution = suites.getByRole('region', { name: 'Tool execution' });
  if ((await execution.getByText('Demo orders / lookup_order', { exact: true }).count()) === 0) {
    await execution.getByLabel('Available MCP tool').selectOption({ label: 'Demo orders / lookup_order' });
    await execution.getByRole('button', { name: 'Add tool', exact: true }).click();
  }
  await execution.getByLabel('Execution mode').selectOption('mock');
  await execution.getByLabel('Mock response (JSON)').fill(item.mock);
  await page.waitForTimeout(onCamera ? 600 : 100);
}
