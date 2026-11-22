import { showOverlay, test, zoomTo } from '@argo-video/cli';
import { expect } from '@playwright/test';
import { agentSay } from './helpers/agent-panel';
import { closeDesign, replayEpisode1, replayEpisode2, setSectionDesigns } from './course/course-replay';
import { connectAgent, graphNode, ROOT_ID, setUpEpisode, startCamera } from './course/course-session';
import { FINISHED_DESIGN, SECTION_TAGS } from './course/course-texts';

/**
 * Course episode 3, "Choose an architecture" (`demos/course/ep3-choose-an-architecture.plan.md`): the person picks a
 * workflow pattern, the agent applies it and tailors the major workflow, and every section gets its own sub-prompt
 * design. Record with `bun run demo:take -- course-ep3-choose-an-architecture`.
 */
const DEMO_NAME = 'course-ep3-choose-an-architecture';

test(DEMO_NAME, async ({ page, narration }) => {
  test.setTimeout(600_000);
  const episode = await setUpEpisode(page);
  page.on('close', () => void episode.close());
  const agent = await connectAgent();
  page.on('close', () => void agent.close());
  // Off camera: the end state of episodes 1 and 2.
  await replayEpisode1(page, agent, episode.project.dir);
  await replayEpisode2(agent);
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(graphNode(page, 'Customer message')).toBeVisible();

  const { cursor, hold } = await startCamera(page, narration, DEMO_NAME);
  const design = page.getByRole('complementary', { name: 'Prompt design' });
  const workflow = design.getByRole('region', { name: 'Workflow', exact: true });
  const mermaid = workflow.getByRole('textbox', { name: 'Major workflow Mermaid' });

  narration.mark('intro');
  await showOverlay(page, 'intro', narration.durationFor('intro'));

  narration.mark('pattern-catalog');
  await cursor.click(page.getByRole('button', { name: 'Design', exact: true }));
  await workflow.scrollIntoViewIfNeeded();
  await cursor.moveTo(workflow.getByRole('region', { name: 'Workflow preview' }), { target: { x: 0.4, y: 0.5 } });
  await page.waitForTimeout(1500);
  await cursor.click(workflow.getByRole('button', { name: 'Choose pattern', exact: true }));
  const patterns = page.getByRole('dialog', { name: 'Choose a workflow pattern' });
  for (const name of ['Direct prompt', 'Agent with tools', 'Routing', 'Review and improve']) {
    await cursor.click(patterns.getByRole('tab', { name, exact: true }));
    await page.waitForTimeout(1700);
  }
  await hold('pattern-catalog');

  narration.mark('choose');
  void showOverlay(page, 'choose', narration.durationFor('choose'));
  await cursor.click(patterns.getByRole('tab', { name: 'Agent with tools', exact: true }));
  await page.waitForTimeout(1200);
  await cursor.click(patterns.getByRole('button', { name: 'Use pattern', exact: true }));
  await expect(patterns).toBeHidden();
  await expect(mermaid).toHaveValue(/Tool needed\?/);
  await expect(workflow.getByRole('region', { name: 'Workflow preview' }).getByRole('img')).toBeVisible();
  await cursor.moveTo(workflow.getByRole('region', { name: 'Workflow preview' }), { target: { x: 0.6, y: 0.5 } });
  await page.waitForTimeout(1500);
  await cursor.click(design.getByRole('button', { name: 'Save prompt design', exact: true }));
  await expect(design.getByText(/Saved version/)).toBeVisible();
  await hold('choose');

  narration.mark('agent-tailors');
  await agentSay(
    page,
    'you',
    'Make the major workflow specific to this prompt: route by the number of order IDs, look up, compose from tool facts, verify or escalate.',
  );
  await agent.call('list_workflow_patterns');
  await agentSay(page, 'tool', 'list_workflow_patterns');
  await agent.call('apply_workflow_pattern', { rootId: ROOT_ID, patternId: 'tools' });
  await agentSay(page, 'tool', `apply_workflow_pattern ${ROOT_ID} tools`);
  await agent.call('set_design', { rootId: ROOT_ID, workflow: FINISHED_DESIGN.workflow });
  await agentSay(page, 'tool', `set_design ${ROOT_ID} workflow`);
  await expect(mermaid).toHaveValue(/How many order IDs\?/);
  await agentSay(
    page,
    'agent',
    'Workflow saved: every branch ends in the JSON reply. Not found and zero or several IDs go to "Ask for the order ID".',
  );
  await hold('agent-tailors');

  narration.mark('read-diagram');
  const preview = workflow.getByRole('region', { name: 'Workflow preview' });
  await preview.scrollIntoViewIfNeeded();
  // The diagram is wide: zoom the camera onto it while the cursor follows the exits.
  void zoomTo(page, preview, { scale: 2.8, duration: 7000, narration: narration as never });
  // The preview is an image: follow the three exits by position (ask, escalate, JSON reply).
  for (const target of [
    { x: 0.42, y: 0.25 },
    { x: 0.8, y: 0.75 },
    { x: 0.95, y: 0.45 },
  ]) {
    await cursor.moveTo(preview, { target });
    await page.waitForTimeout(1400);
  }
  await hold('read-diagram');

  narration.mark('sub-prompt');
  void showOverlay(page, 'sub-prompt', narration.durationFor('sub-prompt'));
  await closeDesign(page);
  const explorer = page.getByRole('complementary', { name: 'Prompt explorer' });
  await cursor.click(explorer.getByText('Tool use', { exact: true }));
  await cursor.click(explorer.getByRole('button', { name: 'Actions' }));
  await cursor.click(page.getByRole('menuitem', { name: 'Design sub-prompt' }));
  await expect(design.getByText('order-status.tool_use', { exact: true })).toBeVisible();
  await agentSay(page, 'you', 'Set sub-prompt designs for every section. Tool use outputs one lookup_order call.');
  await agent.call('get_design', { rootId: ROOT_ID });
  await agentSay(page, 'tool', `get_design ${ROOT_ID}`);
  // One call per section; Tool use last, so the panel ends on its contract.
  for (const tag of SECTION_TAGS) {
    await setSectionDesigns(agent, [tag]);
    await agentSay(page, 'tool', `set_design ${ROOT_ID} ${tag}`);
  }
  const output = design.getByRole('region', { name: 'Expected output' });
  await output.scrollIntoViewIfNeeded();
  await expect(output.getByRole('textbox', { name: 'Required tool name' })).toHaveValue('lookup_order');
  await agentSay(
    page,
    'agent',
    'Five sub-prompt designs saved. Tool use: input is the customer message, output is a tool call to lookup_order.',
  );
  await cursor.moveTo(output.getByRole('textbox', { name: 'Required tool name' }), { target: { x: 0.3, y: 0.5 } });
  await hold('sub-prompt');

  narration.mark('readiness');
  const readiness = design.getByRole('region', { name: 'Readiness' });
  await readiness.scrollIntoViewIfNeeded();
  await expect(readiness).toContainText('Structurally ready');
  await cursor.moveTo(readiness, { target: { x: 0.4, y: 0.6 } });
  await hold('readiness');

  narration.mark('recap');
  void showOverlay(page, 'recap', narration.durationFor('recap'));
  await closeDesign(page);
  await cursor.click(page.getByRole('button', { name: 'Graph', exact: true }));
  await hold('recap');

  await cursor.dispose();
  await agent.close();
});
