import { expect, type Locator, type Page } from '@playwright/test';
import { acceptProposals, CASES, fillCase, PROPOSALS, principle } from './course-checks';
import { type Agent, MODEL_NAME, openProjectQuickly, ROOT_ID } from './course-session';
import {
  DRAFT_REVIEWED,
  FINISHED_DESIGN,
  MISSION,
  OUTPUT_DESCRIPTION,
  PROJECT_JSON,
  SECTION_TAGS,
  sectionDesigns,
  withExamples,
} from './course-texts';

/**
 * Off-camera replays of each episode's end state, run before `narration.startRecording` so an episode starts where
 * the previous one ended. They use the same UI and MCP calls as the episodes, without the cursor or pauses.
 */

/** Episode 1: the prompt with its mission, tool, variable and JSON input and output contracts. */
export async function replayEpisode1(page: Page, agent: Agent, dir: string): Promise<void> {
  await openProjectQuickly(page, dir);
  await page.getByRole('banner').getByRole('button', { name: 'New prompt', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a prompt' });
  const [tool, variable] = [PROJECT_JSON.tools[0], PROJECT_JSON.variables[0]];
  await dialog.getByRole('textbox', { name: 'Prompt title' }).fill('Order status');
  await dialog.getByText('Inputs and tools', { exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Tool', exact: true }).fill(tool.name);
  await dialog.getByRole('textbox', { name: 'Tool description' }).fill(tool.description);
  await dialog.getByRole('textbox', { name: 'Input JSON Schema' }).fill(JSON.stringify(tool.inputSchema, null, 2));
  await dialog.getByRole('textbox', { name: 'Variable', exact: true }).fill(variable.name);
  await dialog.getByRole('textbox', { name: 'Variable purpose' }).fill(variable.purpose);
  await dialog.getByRole('textbox', { name: 'Example value' }).fill(variable.sample);
  await dialog.getByRole('button', { name: 'Create prompt', exact: true }).click();
  await expect(dialog).toBeHidden();
  await agent.call('open_document', { rootId: ROOT_ID });
  const text = await agent.call('read_document', { rootId: ROOT_ID });
  await agent.call('edit_document', {
    rootId: ROOT_ID,
    text: text.replace("Describe this prompt's primary responsibility.", MISSION),
    message: 'Mission',
  });
  await agent.call('set_design', {
    rootId: ROOT_ID,
    input: FINISHED_DESIGN.input,
    output: {
      kind: 'json',
      description: OUTPUT_DESCRIPTION,
      jsonSchema: FINISHED_DESIGN.output.jsonSchema,
      examples: [FINISHED_DESIGN.output.examples[1]],
    },
  });
  await closeDesign(page);
}

/** Episode 2: the reviewed draft (data rule first, order ID format in Tool use step 1). */
export async function replayEpisode2(agent: Agent): Promise<void> {
  await agent.call('edit_document', { rootId: ROOT_ID, text: DRAFT_REVIEWED, message: 'Draft and review' });
}

/** Episode 3: the tailored major workflow and a sub-prompt design for every section. */
export async function replayEpisode3(agent: Agent): Promise<void> {
  await agent.call('set_design', { rootId: ROOT_ID, workflow: FINISHED_DESIGN.workflow });
  await setSectionDesigns(agent, SECTION_TAGS);
}

/** Saves the finished sub-prompt designs of the named sections, one set_design call each. */
export async function setSectionDesigns(agent: Agent, tags: string[], examples?: unknown[]): Promise<void> {
  for (const { sectionId, ...contract } of sectionDesigns(tags, examples)) {
    await agent.call('set_design', { rootId: ROOT_ID, sectionId: sectionId.replace(`${ROOT_ID}.`, ''), ...contract });
  }
}

/**
 * Episode 4: three output examples, the company_name variable (configuration lifecycle), the "Demo orders" MCP
 * server, and lookup_order selected in the run setup (real calls, as the episode ends). Expects the model connected.
 */
export async function replayEpisode4(page: Page, agent: Agent, ordersUrl: string): Promise<void> {
  const examples = FINISHED_DESIGN.output.examples;
  await setSectionDesigns(agent, ['output_format'], examples);
  await agent.call('set_design', { rootId: ROOT_ID, output: FINISHED_DESIGN.output });
  await closeDesign(page);
  const company = PROJECT_JSON.variables[1];
  await page.getByRole('button', { name: 'Variables', exact: true }).click();
  const variables = page.getByRole('complementary', { name: 'Project variables' });
  await variables.getByRole('button', { name: 'Add variable', exact: true }).click();
  const form = variables.locator('#project-definition-editor');
  await form.getByLabel('Name', { exact: true }).fill(company.name);
  await form.getByLabel('Purpose', { exact: true }).fill(company.purpose);
  await form.getByLabel('Example value', { exact: true }).fill(company.sample);
  await form.getByText('Advanced settings', { exact: true }).click();
  await form.getByLabel('Value source').selectOption('configuration');
  await variables.getByRole('button', { name: 'Save variable', exact: true }).click();
  await expect(variables.getByText('company_name', { exact: true })).toBeVisible();
  await variables.getByRole('button', { name: /close/i }).first().click();
  await page.keyboard.press('Alt+4');
  const workspace = page.locator('[data-studio-panels]');
  await workspace.getByRole('tab', { name: 'Settings', exact: true }).click();
  await workspace.getByRole('button', { name: 'Open app settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'App settings', exact: true });
  await settings.getByRole('tab', { name: 'MCP servers', exact: true }).click();
  const servers = settings.getByRole('region', { name: 'MCP servers' });
  await servers.getByLabel('Server name').fill('Demo orders');
  await servers.getByLabel('MCP endpoint URL').fill(ordersUrl);
  await servers.getByRole('button', { name: 'Save server', exact: true }).click();
  await servers.getByRole('button', { name: 'Discover tools', exact: true }).click();
  await expect(servers.getByText(/1 discovered tools/)).toBeVisible();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await workspace.getByRole('tab', { name: 'Single run', exact: true }).click();
  const single = workspace.getByRole('tabpanel', { name: 'Single run', exact: true });
  await single.getByText(/^Tool responses · \d selected$/).click();
  const execution = single.getByRole('region', { name: 'Tool execution' });
  await execution.getByLabel('Available MCP tool').selectOption({ label: 'Demo orders / lookup_order' });
  await execution.getByRole('button', { name: 'Add tool', exact: true }).click();
  await execution.getByLabel('Execution mode').selectOption('real');
  // Saved, so test cases can reuse it as their shared tool responses.
  await workspace.getByRole('button', { name: 'Save run setup', exact: true }).click();
  await expect(workspace.getByText('Unsaved setup changes')).toBeHidden();
  await workspace.getByRole('button', { name: 'Close run workspace', exact: true }).click();
  await expect(workspace).toBeHidden();
}

/**
 * Episode 5: the data criterion and the eleven accepted proposals, the Examples section, and the seven-case suite
 * "Order status regression", run once so its passing results are on screen.
 */
export async function replayEpisode5(page: Page, agent: Agent): Promise<void> {
  const click = (target: Locator) => target.click();
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  const verify = page.getByRole('complementary', { name: /^Verify/ });
  await verify.getByRole('tab', { name: 'Checks & criteria', exact: true }).click();
  await verify.getByRole('combobox', { name: 'Verification section' }).selectOption({ label: 'Rules' });
  await verify.getByRole('button', { name: 'Add AI criterion', exact: true }).first().click();
  await verify
    .getByRole('textbox', { name: /^AI criterion \d+$/ })
    .last()
    .fill(principle('customer-text-is-data'));
  await verify.getByRole('button', { name: 'Save checks and recheck', exact: true }).click();
  await expect(verify.getByText('Checks saved and rechecked')).toBeVisible();
  for (const { label: _label, ...proposal } of PROPOSALS)
    await agent.call('propose_check', { rootId: ROOT_ID, ...proposal });
  await acceptProposals(page, click);
  await verify.getByRole('button', { name: /close/i }).first().click();
  const text = await agent.call('read_document', { rootId: ROOT_ID });
  await agent.call('edit_document', { rootId: ROOT_ID, text: withExamples(text), message: 'Add edge-case examples' });
  await setSectionDesigns(agent, ['examples']);
  await closeDesign(page);
  await page.keyboard.press('Alt+5');
  const workspace = page.locator('[data-studio-panels]');
  await workspace.getByRole('tab', { name: 'Test suites', exact: true }).click();
  const suites = workspace.getByRole('tabpanel', { name: 'Test suites', exact: true });
  await suites.getByRole('button', { name: 'New suite', exact: true }).click();
  await suites.getByRole('textbox', { name: 'Suite name', exact: true }).fill('Order status regression');
  for (const [index, item] of CASES.entries()) {
    if (index > 0) await suites.getByRole('button', { name: 'Add test', exact: true }).click();
    await fillCase(page, undefined, suites, item, false);
  }
  await suites.getByRole('button', { name: 'Save suite', exact: true }).click();
  await suites.getByRole('button', { name: 'Run test suite', exact: true }).click();
  for (const item of CASES)
    await expect(workspace.getByRole('region', { name: `Results for ${item.name}` })).toContainText('passed', {
      timeout: 60_000,
    });
}

/** Connects the local test model in App settings (Run → Settings → Open app settings). */
export async function connectModel(page: Page, modelUrl: string): Promise<void> {
  await page.keyboard.press('Alt+4');
  const workspace = page.locator('[data-studio-panels]');
  await workspace.getByRole('tab', { name: 'Settings', exact: true }).click();
  await workspace.getByRole('button', { name: 'Open app settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'App settings', exact: true });
  await settings.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('openai-compat');
  await settings.getByLabel('Model', { exact: true }).fill(MODEL_NAME);
  await settings.getByLabel(/^API base URL/).fill(modelUrl);
  await settings.getByLabel(/^API key/).fill('local-test-key');
  await settings.getByRole('button', { name: /^Save settings/ }).click();
  await expect(settings.getByRole('button', { name: /^Save settings/ })).toBeEnabled();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(settings).toBeHidden();
  await workspace.getByRole('button', { name: 'Close run workspace', exact: true }).click();
  await expect(workspace).toBeHidden();
}

export async function closeDesign(page: Page): Promise<void> {
  const design = page.getByRole('complementary', { name: 'Prompt design' });
  if (await design.isVisible()) {
    await design.getByRole('button', { name: /close/i }).first().click();
    await expect(design).toBeHidden();
  }
}
