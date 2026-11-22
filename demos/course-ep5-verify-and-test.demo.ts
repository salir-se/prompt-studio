import { showOverlay, test } from '@argo-video/cli';
import { expect } from '@playwright/test';
import { agentSay } from './helpers/agent-panel';
import { acceptProposals, CASES, fillCase, PROPOSALS, principle } from './course/course-checks';
import {
  closeDesign,
  connectModel,
  replayEpisode1,
  replayEpisode2,
  replayEpisode3,
  replayEpisode4,
  setSectionDesigns,
} from './course/course-replay';
import { connectAgent, graphNode, ROOT_ID, setUpEpisode, startCamera, typeInto } from './course/course-session';
import { withExamples } from './course/course-texts';

/**
 * Course episode 5, "Verify and test" (`demos/course/ep5-verify-and-test.plan.md`): automatic findings, one AI
 * criterion added by hand, checks proposed by the agent and accepted by the person, an AI review finding fixed by
 * adding the Examples section, and a seven-case, edge-case-first test suite that passes.
 * Record with `bun run demo:take -- course-ep5-verify-and-test`.
 */
const DEMO_NAME = 'course-ep5-verify-and-test';
const DATA_CRITERION = principle('customer-text-is-data');

test(DEMO_NAME, async ({ page, narration }) => {
  test.setTimeout(900_000);
  const episode = await setUpEpisode(page);
  page.on('close', () => void episode.close());
  const agent = await connectAgent();
  page.on('close', () => void agent.close());
  // Off camera: the end state of episodes 1–4.
  await replayEpisode1(page, agent, episode.project.dir);
  await replayEpisode2(agent);
  await replayEpisode3(agent);
  await closeDesign(page);
  await connectModel(page, episode.model.url);
  await replayEpisode4(page, agent, episode.orders.url);
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await page
    .getByRole('button', { name: /fit view/i })
    .first()
    .click();
  await expect(graphNode(page, 'Customer message')).toBeVisible();

  const { cursor, hold } = await startCamera(page, narration, DEMO_NAME);
  const verify = page.getByRole('complementary', { name: /^Verify/ });
  const scope = verify.getByRole('combobox', { name: 'Verification section' });
  const chooseScope = async (label: string) => {
    await cursor.click(scope);
    await scope.selectOption({ label });
    await page.waitForTimeout(400);
  };

  narration.mark('intro');
  await showOverlay(page, 'intro', narration.durationFor('intro'));

  narration.mark('automatic');
  await cursor.click(page.getByRole('button', { name: 'Verify', exact: true }));
  await cursor.click(verify.getByRole('button', { name: 'Recheck prompt', exact: true }));
  await expect(verify.getByRole('status').getByText('Automatic checks complete')).toBeVisible();
  await expect(verify.getByRole('tab', { name: /^Findings · 1$/ })).toBeVisible();
  await cursor.moveTo(verify.getByRole('region', { name: 'Verification summary' }), { target: { x: 0.3, y: 0.5 } });
  await page.waitForTimeout(1500);
  await cursor.click(verify.getByRole('tab', { name: 'Checks & criteria', exact: true }));
  await chooseScope('Rules');
  await cursor.click(verify.getByRole('button', { name: 'Add AI criterion', exact: true }).first());
  await typeInto(cursor, verify.getByRole('textbox', { name: /^AI criterion \d+$/ }).last(), DATA_CRITERION, 8);
  await cursor.click(verify.getByRole('button', { name: 'Save checks and recheck', exact: true }));
  await expect(verify.getByText('Checks saved and rechecked')).toBeVisible();
  await hold('automatic');

  narration.mark('agent-proposes');
  void showOverlay(page, 'agent-proposes', narration.durationFor('agent-proposes'));
  await agentSay(
    page,
    'you',
    'What should be checked that is not covered yet? Propose checks; I will accept them in Prompt Studio.',
  );
  await agent.call('list_checks', { rootId: ROOT_ID });
  await agentSay(page, 'tool', `list_checks ${ROOT_ID}`);
  const proposalIds: string[] = [];
  for (const { label, ...proposal } of PROPOSALS) {
    const result = JSON.parse(await agent.call('propose_check', { rootId: ROOT_ID, ...proposal }));
    proposalIds.push(result.proposalId);
    await agentSay(page, 'tool', `propose_check ${label}`);
  }
  await agentSay(page, 'agent', 'Eleven proposals are waiting for you: six automatic checks and five AI criteria.');
  await acceptProposals(page, (target) => cursor.click(target));
  await hold('agent-proposes');

  narration.mark('run-checks');
  const statuses = await Promise.all(
    proposalIds.map(async (proposalId) => JSON.parse(await agent.call('get_proposal_status', { proposalId })).status),
  );
  expect(statuses).toEqual(proposalIds.map(() => 'accepted'));
  await agentSay(page, 'tool', `get_proposal_status ×${proposalIds.length} → accepted`);
  await agent.call('run_checks', { rootId: ROOT_ID });
  await agentSay(page, 'tool', `run_checks ${ROOT_ID}`);
  await agent.call('get_findings', { rootId: ROOT_ID });
  await agentSay(page, 'tool', `get_findings ${ROOT_ID}`);
  await agentSay(
    page,
    'agent',
    'All eleven accepted. Automatic checks: 0 errors, 1 warning (customer_message is dynamic, expected).',
  );
  await expect(verify.getByRole('tab', { name: /^Findings · 1$/ })).toBeVisible();
  await hold('run-checks');

  narration.mark('ai-review');
  await cursor.click(verify.getByRole('tab', { name: 'AI review', exact: true }));
  await chooseScope('Whole prompt');
  const review = verify.getByRole('region', { name: 'Semantic review' });
  await cursor.click(review.getByRole('button', { name: /^(Run AI review|Run again)$/ }));
  await expect(review.getByText(/No example shows an order that is not found/)).toBeVisible({ timeout: 30_000 });
  await cursor.moveTo(review.getByText(/No example shows an order that is not found/), { target: { x: 0.3, y: 0.5 } });
  await hold('ai-review');

  narration.mark('fix-at-source');
  void showOverlay(page, 'fix-at-source', narration.durationFor('fix-at-source'));
  await agentSay(
    page,
    'you',
    'Fix that at the source: add an Examples section before the output format, edge cases first: no order ID, not found, the injection attempt, an upset customer who wants a refund.',
  );
  // insert_section would place a bare <examples> block under the "## Tool use" heading (it is titled "Tool use"
  // in Graph), so the agent writes the heading and the block with one whole-document edit instead.
  const current = await agent.call('read_document', { rootId: ROOT_ID });
  await agentSay(page, 'tool', `read_document ${ROOT_ID}`);
  await agent.call('edit_document', {
    rootId: ROOT_ID,
    text: withExamples(current),
    message: 'Add edge-case examples',
  });
  await agentSay(page, 'tool', `edit_document ${ROOT_ID} "Add edge-case examples"`);
  await setSectionDesigns(agent, ['examples']);
  await agentSay(page, 'tool', `set_design ${ROOT_ID} examples`);
  await agentSay(page, 'agent', 'Added Examples with four worked answers. Each answer matches the output schema.');
  // set_design opened the new section's design; go back to Verify, recheck and review again.
  await page.waitForTimeout(1200);
  await closeDesign(page);
  await cursor.click(page.getByRole('button', { name: 'Verify', exact: true }));
  await cursor.click(verify.getByRole('button', { name: 'Recheck prompt', exact: true }));
  await expect(verify.getByRole('status').getByText('Automatic checks complete')).toBeVisible();
  await cursor.click(verify.getByRole('tab', { name: 'AI review', exact: true }));
  if ((await scope.inputValue()) !== (await scope.locator('option', { hasText: 'Whole prompt' }).getAttribute('value')))
    await chooseScope('Whole prompt');
  await cursor.click(review.getByRole('button', { name: /^(Run AI review|Run again)$/ }));
  await expect(review.getByText(/No AI issues found/)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await cursor.click(verify.getByRole('button', { name: /close/i }).first());
  await cursor.click(page.getByRole('button', { name: 'Graph', exact: true }));
  await cursor.click(page.getByRole('button', { name: /fit view/i }).first());
  await expect(graphNode(page, 'Examples')).toBeVisible();
  await cursor.moveTo(graphNode(page, 'Examples'), { target: { x: 0.5, y: 0.4 } });
  await hold('fix-at-source');

  narration.mark('edge-tests');
  void showOverlay(page, 'edge-tests', narration.durationFor('edge-tests'));
  await page.keyboard.press('Alt+5');
  const workspace = page.locator('[data-studio-panels]');
  await cursor.click(workspace.getByRole('tab', { name: 'Test suites', exact: true }));
  const suites = workspace.getByRole('tabpanel', { name: 'Test suites', exact: true });
  await cursor.click(suites.getByRole('button', { name: 'New suite', exact: true }));
  await typeInto(
    cursor,
    suites.getByRole('textbox', { name: 'Suite name', exact: true }),
    'Order status regression',
    20,
  );
  for (const [index, item] of CASES.entries()) {
    if (index > 0) await cursor.click(suites.getByRole('button', { name: 'Add test', exact: true }));
    await fillCase(page, cursor, suites, item, index < 2);
  }
  await cursor.click(suites.getByRole('button', { name: 'Save suite', exact: true }));
  await hold('edge-tests');

  narration.mark('run-suite');
  await cursor.click(suites.getByRole('button', { name: 'Run test suite', exact: true }));
  for (const item of CASES)
    await expect(workspace.getByRole('region', { name: `Results for ${item.name}` })).toContainText('passed', {
      timeout: 60_000,
    });
  const injection = workspace.getByRole('region', { name: 'Results for Injection attempt' });
  await injection.scrollIntoViewIfNeeded();
  await expect(injection.getByText(/I can't change orders or issue refunds/).first()).toBeVisible();
  await cursor.moveTo(injection.getByText(/I can't change orders or issue refunds/).first(), {
    target: { x: 0.3, y: 0.5 },
  });
  await hold('run-suite');

  narration.mark('recap');
  void showOverlay(page, 'recap', narration.durationFor('recap'));
  await hold('recap');

  await cursor.dispose();
  await agent.close();
});
