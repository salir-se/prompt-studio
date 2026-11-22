import { expect, test } from './helpers/mcp-studio-fixture';

interface Proposal {
  proposalId: string;
  status: string;
  saved?: { statement?: string };
}

/**
 * Outcome test (roadmap #8): an AI agent runs the automatic checks and PROPOSES checks through MCP; the person
 * decides in Verify → Checks & criteria. A proposal is never saved by the agent: it shows as Proposed, the person
 * accepts one, edits and accepts another, rejects a third, and the agent reads each decision back.
 */
test('an agent proposes checks; the person accepts, edits or rejects them in Checks & criteria', async ({
  page,
  agent,
}) => {
  // Given: the agent opens the order-status prompt and runs the automatic checks
  await agent.call('open_document', { rootId: 'order-status' });
  const run = await agent.json<{ findings: unknown[]; state: string }>('run_checks', { rootId: 'order-status' });
  const verify = page.getByRole('complementary', { name: 'Verify', exact: true });
  await expect(verify).toBeVisible();
  expect(Array.isArray(run.findings)).toBe(true);
  const fresh = await agent.json<{ automatic: { freshness: string } }>('get_findings', { rootId: 'order-status' });
  expect(fresh.automatic.freshness).toBe('current');

  // When: the agent proposes that the tools section must mention lookup_order
  const rule = await agent.json<Proposal>('propose_check', {
    rootId: 'order-status',
    sectionId: 'tools',
    kind: 'rule',
    rule: { kind: 'required-tool', name: 'lookup_order', severity: 'error' },
  });

  // Then: it is proposed, not saved — Checks & criteria shows it as Proposed and the agent sees "pending"
  expect(rule.status).toBe('proposed');
  const proposed = verify.getByRole('region', { name: 'Proposed checks', exact: true });
  await expect(proposed.getByText('Mentions lookup_order.', { exact: true })).toBeVisible();
  expect((await agent.json<Proposal>('get_proposal_status', { proposalId: rule.proposalId })).status).toBe('pending');
  const before = await agent.json<{ scopes: { proposed: unknown[] }[] }>('list_checks', {
    rootId: 'order-status',
    sectionId: 'tools',
  });
  expect(before.scopes[0]?.proposed).toHaveLength(1);

  // When: the person accepts it
  await proposed.getByRole('button', { name: 'Accept proposal', exact: true }).click();

  // Then: the check is saved with the others and the agent reads "accepted"
  await expect(verify.getByText('Checks saved and rechecked', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await agent.json<Proposal>('get_proposal_status', { proposalId: rule.proposalId })).status)
    .toBe('accepted');
  const saved = await agent.json<{ scopes: { profiles: { automatic: { kind: string; origin: string }[] }[] }[] }>(
    'list_checks',
    { rootId: 'order-status', sectionId: 'tools' },
  );
  expect(saved.scopes[0]?.profiles.flatMap((profile) => profile.automatic)).toContainEqual(
    expect.objectContaining({ kind: 'required-tool', origin: 'authored' }),
  );

  // When: the agent proposes an AI criterion for the whole prompt, and the person rewords it before accepting
  const criterion = await agent.json<Proposal>('propose_check', {
    rootId: 'order-status',
    kind: 'criterion',
    statement: 'The reply never guesses an order status.',
  });
  const wording = verify.getByRole('textbox', { name: 'Proposed AI criterion', exact: true });
  await wording.fill('The reply never guesses an order status; it says when the order is unknown.');
  await verify.getByRole('button', { name: 'Accept proposal', exact: true }).click();

  // Then: the agent reads "edited" with the person's wording
  await expect
    .poll(async () => (await agent.json<Proposal>('get_proposal_status', { proposalId: criterion.proposalId })).status)
    .toBe('edited');
  const edited = await agent.json<Proposal>('get_proposal_status', { proposalId: criterion.proposalId });
  expect(edited.saved?.statement).toContain('it says when the order is unknown');

  // When: the agent proposes one more check and the person rejects it
  const extra = await agent.json<Proposal>('propose_check', {
    rootId: 'order-status',
    kind: 'rule',
    rule: { kind: 'minimum-length', minChars: 5000 },
  });
  await verify.getByRole('button', { name: 'Reject proposal', exact: true }).click();

  // Then: it is rejected and nothing was added to the saved checks
  await expect
    .poll(async () => (await agent.json<Proposal>('get_proposal_status', { proposalId: extra.proposalId })).status)
    .toBe('rejected');
  const whole = await agent.json<{ scopes: { profiles: { automatic: { kind: string }[] }[] }[] }>('list_checks', {
    rootId: 'order-status',
  });
  expect(whole.scopes[0]?.profiles.flatMap((profile) => profile.automatic).map((check) => check.kind)).not.toContain(
    'minimum-length',
  );

  // And: after the text changes, the latest automatic findings are reported as stale
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await agent.call('edit_section', { rootId: 'order-status', sectionId: 'role', body: 'You answer order questions.' });
  await expect
    .poll(
      async () =>
        (await agent.json<{ automatic: { freshness: string } }>('get_findings', { rootId: 'order-status' })).automatic
          .freshness,
    )
    .toBe('stale');
});
