/**
 * [SAAS-001.R9] Pure detector for sender identity written INTO a prompt.
 *
 * A prompt writes the email body only; Settings own delivery, the signature and the footer. An email
 * address or a sign-off block inside a prompt (a custom prompt, or a version pinned by one member of a
 * shared Workspace) puts a second signature or a stale address into every draft. The detector is the
 * deterministic half of the advisory `identity-in-prompt` structure check (`verification-profiles.ts`).
 *
 * No React, no I/O. Findings carry a 1-based line number and the matched text; an email address is
 * masked (`a***@domain`) so a warning never repeats a person's address.
 */

export type IdentityInPromptKind = 'email' | 'sign-off';

export interface IdentityInPromptMatch {
  kind: IdentityInPromptKind;
  /** 1-based line of the address, or of the closing phrase of a sign-off. */
  line: number;
  /** Masked address, or `<closing phrase> / <signature line>` for a sign-off. */
  text: string;
}

export const IDENTITY_EMAIL_MESSAGE =
  'Prompts write the email body only. Remove this email address; Settings add the sender details.';
export const IDENTITY_SIGN_OFF_MESSAGE =
  'Prompts write the email body only. Remove this sign-off; Settings add the signature.';

const EMAIL_RE =
  /(?<![\w.%+@-])[A-Za-z0-9][A-Za-z0-9._%+-]*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}(?![\w@-])/g;

/** A whole line that is a closing phrase. "Thanks" / "Thank you" need their comma so prose never matches. */
const CLOSING_LINE_RE =
  /^\s*(?:(?:best|kind|warm|warmest|many|with (?:kind|best|warm))\s+regards|regards|sincerely(?:\s+yours)?|yours\s+(?:sincerely|truly|faithfully)|cheers|thanks,|thank you,|med vänliga hälsningar|vänliga hälsningar|hälsningar|mvh)\s*[,!]?\s*$/iu;

const NAME_WORD = String.raw`\p{Lu}[\p{L}'’.-]*`;
const NAME_LINE_RE = new RegExp(String.raw`^\s*${NAME_WORD}(?:\s+${NAME_WORD}){0,3}\s*$`, 'u');
const PLACEHOLDER_ONLY_LINE_RE = /^\s*(?:\{\{[^{}]*\}\}[\s,|·•-]*)+$/;
const TITLE_LINE_RE =
  /^(?=(?:\S+\s*){1,8}$).*\b(?:CEO|CTO|COO|CFO|CMO|CRO|VP|Founder|Co-?founder|President|Director|Head of|Manager|Engineer|Developer|Consultant|Partner|Advisor|Adviser|Officer|Lead|Owner|Sales|Account Executive)\b/i;
const COMPANY_LINE_RE = /^.{1,60}\s(?:AB|Inc\.?|Ltd\.?|LLC|GmbH|Corp\.?|Oy|AS|Limited)\s*$/;
const URL_LINE_RE =
  /(?:https?:\/\/|www\.)\S+|^\s*[\w-]+(?:\.[\w-]+)*\.(?:com|se|io|net|org|ai|co|dev|app|example)\s*$/i;

/**
 * Canonical instruction text that teaches signature rules and is therefore exempt, matched by exact
 * text. Prompt Studio ships no built-in prompts, so nothing is exempt.
 */
export function identityExemptBlocks(): readonly string[] {
  return [];
}

/** `maja.lind@acma.example` -> `m***@acma.example`. */
export function maskEmailAddress(address: string): string {
  const at = address.lastIndexOf('@');
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}

/** Replaces every exempt block with the same number of inert lines, so line numbers stay true. */
function withoutExemptBlocks(text: string): string {
  let result = text;
  for (const block of identityExemptBlocks()) {
    if (!result.includes(block)) continue;
    const inert = Array.from({ length: block.split('\n').length }, () => '\u0000').join('\n');
    result = result.split(block).join(inert);
  }
  return result;
}

function isSignatureLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.endsWith(':')) return false;
  return (
    NAME_LINE_RE.test(trimmed) ||
    PLACEHOLDER_ONLY_LINE_RE.test(trimmed) ||
    TITLE_LINE_RE.test(trimmed) ||
    COMPANY_LINE_RE.test(trimmed) ||
    URL_LINE_RE.test(trimmed)
  );
}

/** Every email address and sign-off block in `text`, in line order. Pure. */
export function findIdentityInPrompt(text: string): IdentityInPromptMatch[] {
  const lines = withoutExemptBlocks(text.replace(/\r\n?/g, '\n')).split('\n');
  const matches: IdentityInPromptMatch[] = [];

  lines.forEach((line, index) => {
    for (const email of line.matchAll(EMAIL_RE)) {
      matches.push({ kind: 'email', line: index + 1, text: maskEmailAddress(email[0]) });
    }
    if (!CLOSING_LINE_RE.test(line)) return;
    const signature = [lines[index + 1], lines[index + 2]].find((next) => next !== undefined && isSignatureLine(next));
    if (signature === undefined) return;
    matches.push({ kind: 'sign-off', line: index + 1, text: `${line.trim()} / ${signature.trim()}` });
  });

  return matches;
}

export function identityInPromptMessage(kind: IdentityInPromptKind): string {
  return kind === 'email' ? IDENTITY_EMAIL_MESSAGE : IDENTITY_SIGN_OFF_MESSAGE;
}
