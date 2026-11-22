import type { Evaluation } from '../../src/run/contracts';
import { startEvaluationProvider } from './helpers/evaluation-provider';
import { expect, test } from './helpers/mcp-studio-fixture';

test('MCP runs and compares saved suites with explicit consent and shares the results with Evaluations', async ({
  page,
  agent,
}) => {
  const model = await startEvaluationProvider();
  try {
    const rootId = 'order-status';
    const promptPath = 'prompts/order-status.md';
    const suiteId = 'order-suite';
    const origin = new URL(page.url()).origin;
    const token = await page.locator('meta[name="studio-token"]').getAttribute('content');
    const headers = { origin, 'x-studio-token': token ?? '' };
    const post = async (path: string, data: unknown) => {
      const response = await page.request.post(`${origin}/__studio/${path}`, { headers, data });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    const status = await page.request.get(`${origin}/__studio/prompt-repo`, { headers });
    const { projectId, revision } = await status.json();
    await post('run/settings', {
      provider: 'openai-compat',
      model: 'local-test',
      apiKey: 'fixture',
      baseUrl: `${model.url}/v1`,
    });
    await post('run/suites', {
      projectId,
      revision,
      suite: {
        id: suiteId,
        name: 'Order acceptance',
        promptPath,
        cases: [
          {
            id: 'pass',
            name: 'Expected label',
            inputs: { customer_message: 'Order 1' },
            userMessage: 'Order 1',
            checks: { contains: ['positive'] },
          },
          {
            id: 'fail',
            name: 'Unexpected label',
            inputs: { customer_message: 'Order 2' },
            userMessage: 'Order 2',
            checks: { contains: ['negative'] },
          },
        ],
      },
    });
    await agent.call('open_document', { rootId });
    expect(await agent.json('list_suites', { rootId })).toMatchObject([{ id: suiteId, name: 'Order acceptance' }]);
    await expect(agent.call('run_suite', { rootId, suiteId })).rejects.toThrow(/allowPaidRun/);
    await expect(
      agent.call('compare_versions', { rootId, suiteId, baselineTag: 'v1', allowPaidRun: false }),
    ).rejects.toThrow(/allowPaidRun/);

    const waitForEvaluation = async (id: string) => {
      await expect
        .poll(async () => (await agent.json<Evaluation>('get_evaluation_results', { rootId, evaluationId: id })).status)
        .toBe('completed');
      return agent.json<Evaluation>('get_evaluation_results', { rootId, evaluationId: id });
    };
    await page.keyboard.press('Alt+5');
    const panel = page.getByRole('complementary', { name: 'Evaluations', exact: true });
    await expect(panel).toBeVisible();
    const run = await agent.json<{ id: string }>('run_suite', { rootId, suiteId, allowPaidRun: true });
    expect((await waitForEvaluation(run.id)).results).toMatchObject([
      { caseId: 'pass', status: 'passed' },
      { caseId: 'fail', status: 'failed' },
    ]);
    const saved = panel.getByRole('combobox', { name: 'Saved evaluation results', exact: true });
    await expect(saved).toHaveValue(run.id);
    const summary = panel.getByRole('region', { name: 'Evaluation summary', exact: true });
    await expect(summary.getByText('1 passed', { exact: true })).toBeVisible();
    await expect(summary.getByText('1 failed', { exact: true })).toBeVisible();

    const tagged = await post('prompt-repo/tags', { projectId, revision, name: 'v1' });
    await post('prompt-repo/tags', { projectId, revision: tagged.revision, name: 'v2' });
    const writer = page.getByRole('textbox', { name: 'Prompt markdown', exact: true });
    await writer.fill(`${await writer.inputValue()}\nUse the latest order details.`);
    for (const candidateTag of [undefined, 'v2']) {
      const comparison = await agent.json<{ id: string }>('compare_versions', {
        rootId,
        suiteId,
        baselineTag: 'v1',
        candidateTag,
        allowPaidRun: true,
      });
      const result = await waitForEvaluation(comparison.id);
      expect(result.candidates.map((candidate) => candidate.id)).toEqual([
        'tag:v1',
        candidateTag ? 'tag:v2' : 'working',
      ]);
      expect(result.candidates[1]?.label).toBe(candidateTag ?? 'Current draft');
      expect(result.results).toHaveLength(4);
      await expect(saved).toHaveValue(comparison.id);
    }
  } finally {
    model.close();
  }
});
