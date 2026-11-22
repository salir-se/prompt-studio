// @module-tag pure
import { describe, expect, it } from 'vitest';
import { reviewReply, triageReply } from './tutorial-model';

const OUTPUT_LINE = '{"category": "billing", "urgency": "high", "next_step": "<one sentence>"}';
const system = (criteria: unknown[]) =>
  [
    'Review the selected prompt scope against only its registered criteria.',
    `Criteria: ${JSON.stringify(criteria)}`,
  ].join('\n');
const user = (text: string) => JSON.stringify({ fragment: { scope: 'consolidated', text }, dependencies: [] });

describe('tutorial model', () => {
  it('links its AI-review finding to the next_step criterion and quotes the prompt exactly', () => {
    // Given: a scope with a platform criterion and an authored next_step criterion
    const criteria = [
      { id: 'output-contract', owner: 'platform', statement: 'output contract: {"next_step": "string"}' },
      { id: 'next-step', owner: 'configuration', statement: 'next_step names one concrete action.' },
    ];
    // When: the model reviews a prompt whose output format mentions next_step
    const [finding] = JSON.parse(reviewReply(system(criteria), user(`Route it.\n${OUTPUT_LINE}`)));
    // Then: the finding names the authored criterion and an exact quote from the prompt
    expect(finding.principleId).toBe('next-step');
    expect(OUTPUT_LINE).toContain(finding.evidenceQuote);
    expect(finding.evidenceQuote).toBe('"next_step": "<one sentence>"');
  });

  it('returns no findings when no criterion or quote can be linked', () => {
    // Given: criteria unrelated to the output, and a prompt without next_step
    const criteria = [{ id: 'tone', statement: 'Stay polite.' }];
    // When / Then: the review is empty instead of inventing a link
    expect(reviewReply(system(criteria), user(OUTPUT_LINE))).toBe('[]');
    expect(reviewReply(system([{ id: 'n', statement: 'next_step is short' }]), user('No output line.'))).toBe('[]');
    // And: without an authored criterion the output-contract criterion is used
    const [fallback] = JSON.parse(
      reviewReply(system([{ id: 'out', statement: 'Produce this output contract.' }]), user(OUTPUT_LINE)),
    );
    expect(fallback.principleId).toBe('out');
  });

  it('uses the urgent level only when the prompt defines it', () => {
    // Given: an account-takeover message
    const message = 'Someone else used my account to sign in and changed my email.';
    // When / Then: without an urgent level the reply is high; with one it is urgent
    expect(JSON.parse(triageReply(message)).urgency).toBe('high');
    expect(JSON.parse(triageReply(message, '- urgent: the customer reports a security problem')).urgency).toBe(
      'urgent',
    );
    expect(JSON.parse(triageReply(message)).category).toBe('access');
  });
});
