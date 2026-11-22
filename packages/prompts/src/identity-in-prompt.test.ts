// @module-tag pure
/**
 * [SAAS-001.R9] A prompt writes the email body only; Settings own delivery, the signature and the footer.
 * An email address or a sign-off block inside ANY prompt (custom or pinned per member) raises an advisory
 * `identity-in-prompt` warning.
 */
import { describe, expect, it } from 'vitest';
import { findIdentityInPrompt, identityExemptBlocks, maskEmailAddress } from './identity-in-prompt';
import { runLegacyVerificationProfile } from './verification-profiles';

const EMAIL_MESSAGE = 'Prompts write the email body only. Remove this email address; Settings add the sender details.';
const SIGN_OFF_MESSAGE = 'Prompts write the email body only. Remove this sign-off; Settings add the signature.';

describe('[SAAS-001.R9] findIdentityInPrompt', () => {
  it('[SAAS-001.R9] reports an email address with its line number and a masked match', () => {
    // Given: a prompt that hard-codes a sender address on its third line
    const prompt = ['Write short emails.', 'Be direct.', 'Reply-to: maja.lind@acma.example for questions.'].join('\n');

    // When: the prompt is scanned
    const matches = findIdentityInPrompt(prompt);

    // Then: one email match on line 3, masked to the first character and the domain
    expect(matches).toEqual([{ kind: 'email', line: 3, text: 'm***@acma.example' }]);
  });

  it('[SAAS-001.R9] never leaks the local part of a masked address', () => {
    expect(maskEmailAddress('maja.lind+sales@acma.example')).toBe('m***@acma.example');
    expect(maskEmailAddress('a@b.example')).toBe('a***@b.example');
  });

  it.each([
    ['Best regards,', 'Maja Lind'],
    ['Kind regards,', 'Maja Lind'],
    ['Warm regards,', 'Maja Lind'],
    ['Regards,', 'Maja Lind'],
    ['Sincerely,', 'Maja Lind'],
    ['Cheers,', 'Maja'],
    ['Thanks,', 'Maja Lind'],
    ['Med vänliga hälsningar,', 'Maja Lind'],
    ['Hälsningar,', 'Åsa Öberg'],
  ])('[SAAS-001.R9] finds the sign-off "%s" followed by the name line "%s"', (closing, name) => {
    // Given: an instruction that ends with a literal signature block on lines 2-3
    const prompt = `End every email with:\n${closing}\n${name}`;

    // When / Then: one sign-off finding at the closing line, carrying both lines
    expect(findIdentityInPrompt(prompt)).toEqual([{ kind: 'sign-off', line: 2, text: `${closing} / ${name}` }]);
  });

  it.each([
    ['a title line', 'Founder & CEO'],
    ['a company line', 'Acma AB'],
    ['a URL line', 'https://acma.example'],
    ['a bare domain line', 'www.acma.example'],
    ['a placeholder-only line', '{{company_name}}'],
  ])('[SAAS-001.R9] finds a sign-off followed by %s', (_label, line) => {
    expect(findIdentityInPrompt(`Intro\nBest regards,\n${line}`)).toEqual([
      { kind: 'sign-off', line: 2, text: `Best regards, / ${line}` },
    ]);
  });

  it('[SAAS-001.R9] allows one blank line between the closing phrase and the name', () => {
    expect(findIdentityInPrompt('x\nSincerely,\n\nMaja Lind')).toEqual([
      { kind: 'sign-off', line: 2, text: 'Sincerely, / Maja Lind' },
    ]);
  });

  it('[SAAS-001.R9] reports the correct line for several findings in one prompt', () => {
    const prompt = ['a', 'b@acma.example', 'c', 'Cheers,', 'Maja', 'e', 'f', 'Best regards,', 'Jonas Berg'].join('\n');
    expect(findIdentityInPrompt(prompt).map(({ kind, line }) => [kind, line])).toEqual([
      ['email', 2],
      ['sign-off', 4],
      ['sign-off', 8],
    ]);
  });

  describe('false positives', () => {
    it.each([
      'Send my regards to pricing and legal.',
      'Do not write in regards to the pricing page.',
      'Give regards to the prospect only when they asked.',
      'Close the email with a sign-off phrase of your choice, then stop.',
      'Thanks, but no thanks is a valid reply to respect.',
    ])('[SAAS-001.R9] ignores the prose line: %s', (line) => {
      expect(findIdentityInPrompt(`${line}\nMaja Lind`)).toEqual([]);
    });

    it('[SAAS-001.R9] ignores a closing phrase followed by an instruction line', () => {
      expect(findIdentityInPrompt('Best regards,\nnever write this line yourself.')).toEqual([]);
      expect(findIdentityInPrompt('Best regards,\n\n\nMaja Lind')).toEqual([]);
    });

    it('[SAAS-001.R9] ignores a line made only of placeholders', () => {
      expect(
        findIdentityInPrompt('Sell {{product_name}} for {{company_name}} on {{brand_domain}}.\n{{company_name}}'),
      ).toEqual([]);
    });

    it('[SAAS-001.R9] ignores package names and handles that contain an @', () => {
      expect(
        findIdentityInPrompt(
          'Import from @prompt-studio/types and @types/node, mention @maja or @{{handle}} on social.',
        ),
      ).toEqual([]);
    });

    it('[SAAS-001.R9] ignores an address built entirely from placeholders', () => {
      expect(findIdentityInPrompt('Reply to {{sender_email}} or {{local}}@{{brand_domain}}.')).toEqual([]);
    });
  });

  it('[SAAS-001.R9] exempts no instruction block when no built-in prompts ship', () => {
    // Given: a project that ships no built-in prompts
    // When: the exempt blocks are listed
    // Then: nothing is exempt, so every address and sign-off is reported
    expect(identityExemptBlocks()).toEqual([]);
  });
});

describe('[SAAS-001.R9] identity-in-prompt verification rule', () => {
  const TRIAGE_PROMPT = 'You route one customer message for {{company_name}}.\n<mission>\nClassify it.\n</mission>';

  it('[SAAS-001.R9] warns about an email address in a prompt, naming the line and the masked address', () => {
    // Given: a prompt plus a hard-coded address on its last line
    const prompt = `${TRIAGE_PROMPT}\nAlways cc maja.lind@acma.example`;
    const lastLine = prompt.split('\n').length;

    // When: the verification profile runs
    const findings = runLegacyVerificationProfile('support-triage', prompt).filter(
      (finding) => finding.source === 'deterministic' && finding.ruleId === 'identity-in-prompt',
    );

    // Then: one advisory warning in plain words, naming the line and the masked address
    expect(findings).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: EMAIL_MESSAGE,
        subject: `line ${lastLine}: m***@acma.example`,
      }),
    ]);
  });

  it('[SAAS-001.R9] warns about a sign-off block, naming the closing line', () => {
    // Given: a prompt that ends with a literal signature block
    const prompt = `${TRIAGE_PROMPT}\n\nBest regards,\nMaja Lind`;
    const closingLine = prompt.split('\n').length - 1;

    // When: the verification profile runs
    const findings = runLegacyVerificationProfile('support-triage', prompt);

    // Then: one sign-off warning at the closing line
    expect(findings).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: SIGN_OFF_MESSAGE,
        subject: `line ${closingLine}: Best regards, / Maja Lind`,
      }),
    ]);
  });

  it('[SAAS-001.R9] stays advisory: the finding is a warning, never an error', () => {
    // Given / When: a prompt carrying an address is verified
    const found = runLegacyVerificationProfile('persona', 'You are Maja.\nSign as maja@acma.example');

    // Then: the only finding is a warning
    expect(found.map((finding) => finding.severity)).toEqual(['warning']);
  });
});
