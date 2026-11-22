import { startMcpTestServer } from './helpers/startMcpTestServer';
import { expect, test } from './helpers/ui-contract-fixture';

test.use({ localModelRuns: true });
// Outcome: register/discover a real local MCP endpoint, import a schema, and consume mocked then real results through the built app.
test('authors and tests an MCP tool with explicit mock and real execution', async ({ page }) => {
  const fixture = await startMcpTestServer();
  try {
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('menuitem', { name: 'App settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'App settings', exact: true });
    await settings.getByRole('tab', { name: 'Models & skills', exact: true }).click();
    await settings.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('openai-compat');
    await settings.getByLabel('Model', { exact: true }).fill('local-tool-test');
    await settings.getByLabel(/^API base URL/).fill(fixture.url + '/v1');
    await settings.getByLabel(/^API key/).fill('local-fixture-only');
    await settings.getByRole('button', { name: 'Save settings & scan skills' }).click();
    await expect(settings.getByText('Settings saved. Skills were scanned from this folder.')).toBeVisible();
    await settings.getByRole('tab', { name: 'MCP servers', exact: true }).click();
    await settings.getByLabel('Server name', { exact: true }).fill('Research MCP');
    await settings.getByLabel(/^MCP endpoint URL/).fill(fixture.url + '/mcp');
    await settings.getByLabel(/^Bearer token/).fill('local-mcp-only');
    await settings.getByRole('button', { name: 'Save server', exact: true }).click();
    await expect(settings.getByText('Research MCP', { exact: true })).toBeVisible();
    await settings.getByRole('button', { name: 'Discover tools', exact: true }).click();
    await expect(settings.getByText(/1 discovered tools/)).toBeVisible();
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    const tools = page.getByRole('complementary', { name: 'Project tools', exact: true });
    await tools.getByRole('button', { name: 'Browse MCP tools', exact: true }).click();
    await tools.getByRole('button', { name: 'Use lookup_company definition', exact: true }).click();
    await expect(tools.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('lookup_company');
    await tools.getByRole('button', { name: 'Save tool', exact: true }).click();
    await expect(tools.getByText('Saved to this project.', { exact: true })).toBeVisible();
    await tools.getByRole('button', { name: 'Close', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Prompt markdown', exact: true })
      .fill('## Mission\nUse lookup_company to research Acme. Return the tool result.');
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await expect(page.getByText('Saved on this computer', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    const run = page.getByRole('complementary', { name: 'Run and evaluate prompt', exact: true });
    await run.getByText('Tool responses · 0 selected', { exact: true }).click();
    const available = run.getByLabel('Available MCP tool');
    await available.selectOption({ label: 'Research MCP / lookup_company' });
    await run.getByRole('button', { name: 'Add tool', exact: true }).click();
    await expect(run.getByLabel('Execution mode')).toHaveValue('mock');
    await run.getByLabel(/^Mock response/).fill('{"company":"Mock Acme","source":"Predefined response"}');
    await run.getByRole('button', { name: 'Run prompt', exact: true }).click();
    await expect(run.getByRole('region', { name: 'Model output', exact: true })).toContainText('Mock Acme');
    expect(fixture.counts.toolCalls).toBe(0);
    await expect(run.getByText('MOCK', { exact: true })).toBeVisible();
    await run.getByLabel('Execution mode').selectOption('real');
    await run.getByRole('button', { name: 'Run prompt', exact: true }).click();
    await expect(run.getByRole('region', { name: 'Model output', exact: true })).toContainText('Local MCP fixture');
    await expect(run.getByText('REAL', { exact: true })).toBeVisible();
    expect(fixture.counts.toolCalls).toBe(1);
    expect(fixture.counts.modelCalls).toBe(4);
  } finally {
    await fixture.close();
  }
});
