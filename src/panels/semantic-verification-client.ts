import type {
  PromptVerificationFinding,
  PromptVerificationPrinciple,
  PromptVerificationProfile,
} from '@prompt-studio/prompts';

/**
 * Client for the studio server's OPTIONAL semantic (LLM) review endpoint (`POST /verify`).
 *
 * This is a thin, pure fetch wrapper — no React, no state — so `VerificationPanel.tsx` stays
 * testable without a real network. It follows the exact studio-token convention already
 * established by `FinalPromptPanel.tsx`'s `fetchSkillBody` / `bridge-content-source.ts`'s
 * `fetchModuleText`: read the per-boot token from the `<meta name="studio-token">` tag injected
 * by the dev server, send it as `x-studio-token`. `STUDIO_TOKEN_HEADER` is duplicated here on
 * purpose (see `bridge-content-source.ts`'s module doc) rather than imported from
 * `../bridge/fs-bridge.ts`, which pulls in `node:crypto`/`node:fs` and has no browser shim in
 * this app's Vite config — this module ships in the browser bundle.
 *
 * Server contract (implemented by `server/**`):
 *   `POST /verify` — headers `x-studio-token`, body containing the selected section text,
 *     exact profile identity, registered principles, and declared dependency context.
 *     200 `{ ok: true, findings: PromptVerificationFinding[], model: string }`
 *     503 `{ ok: false, error: '...' }` — no provider key configured. NORMAL, not an error.
 *     429 `{ ok: false, error: '...' }` — this session's semantic-review budget is exhausted.
 *     502 / 401 / 403 / 400 / anything else non-2xx — treated as a generic failure.
 *
 * `SemanticVerificationOutcome` never carries the server's raw `error` string, status code, or
 * any provider detail — callers write their own human-facing copy per outcome `kind`, per the
 * "never leak" rule this app's other bridge clients (`bridge-content-source.ts`) already follow.
 * `requestSemanticVerification` never throws: a missing token, no `fetch` global, a network
 * failure, a non-JSON body, or an unexpected shape all degrade to `{ kind: 'failed' }`.
 */

const STUDIO_TOKEN_HEADER = 'x-studio-token';
const VERIFY_ENDPOINT = '/verify';

export type SemanticVerificationOutcome =
  | {
      readonly kind: 'ok';
      readonly findings: readonly PromptVerificationFinding[];
      readonly model: string;
      readonly provenance?: ProjectReviewProvenance;
    }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'budget-exhausted' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'busy' };

export type CompactInterpretationOutcome =
  | { readonly kind: 'ok'; readonly compactText: string; readonly model: string }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'budget-exhausted' }
  | { readonly kind: 'failed' };

export interface ProjectReviewContext {
  projectId: string;
  revision: number;
  promptPath: string;
}
export interface ProjectReviewProvenance extends ProjectReviewContext {
  sourceHash: string;
  profileHash: string;
  provider: string;
}
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface SemanticVerificationContext {
  readonly project?: ProjectReviewContext;
  readonly sourceText?: string;
  readonly profileDefinition?: PromptVerificationProfile;
  readonly profile: { readonly id: string; readonly version: number };
  readonly sectionId: string;
  readonly principles: readonly PromptVerificationPrinciple[];
  readonly dependencies: readonly { readonly sectionId: string; readonly text: string }[];
}

async function readStudioToken(): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  return document.querySelector('meta[name="studio-token"]')?.getAttribute('content') ?? null;
}

/** Narrows an unknown decoded JSON body to the documented 200 success shape. */
function isOkBody(body: unknown): body is { ok: true; findings: PromptVerificationFinding[]; model: string } {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as Record<string, unknown>;
  return candidate.ok === true && Array.isArray(candidate.findings) && typeof candidate.model === 'string';
}

function isCompactOkBody(body: unknown): body is { ok: true; compactText: string; model: string } {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as Record<string, unknown>;
  return candidate.ok === true && typeof candidate.compactText === 'string' && typeof candidate.model === 'string';
}

async function postVerification(body: unknown): Promise<Response | null> {
  if (typeof fetch !== 'function') return null;
  const token = await readStudioToken();
  if (!token) return null;
  return fetch(VERIFY_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [STUDIO_TOKEN_HEADER]: token },
    body: JSON.stringify(body),
  });
}

/**
 * Requests an opt-in semantic review of `text` (the prompt key it belongs to is `promptKey`)
 * against the studio server's `POST /verify`. Callers decide WHEN to call this — it performs no
 * request on its own — so the panel only spends tokens when an operator explicitly asks for one.
 */
export async function requestSemanticVerification(
  promptKey: string,
  text: string,
  context: SemanticVerificationContext = {
    profile: { id: `${promptKey}.legacy.consolidated`, version: 1 },
    sectionId: promptKey,
    principles: [],
    dependencies: [],
  },
): Promise<SemanticVerificationOutcome> {
  try {
    const response = await postVerification(
      context.project
        ? { mode: 'project', ...context.project, profile: context.profile }
        : { promptKey, text, ...context },
    );
    if (!response) return { kind: 'failed' };

    if (response.status === 503) return { kind: 'unavailable' };
    if (response.status === 409 && context.project) return { kind: 'stale' };
    if (response.status === 429) {
      const body = context.project ? await response.json().catch(() => null) : null;
      return { kind: body?.code === 'REVIEW_BUSY' ? 'busy' : 'budget-exhausted' };
    }
    if (!response.ok) return { kind: 'failed' };

    const body: unknown = await response.json();
    if (!isOkBody(body)) return { kind: 'failed' };
    if (context.project) {
      const captured = body as typeof body & ProjectReviewProvenance & { profile?: { id: string; version: number } };
      if (
        captured.projectId !== context.project.projectId ||
        captured.revision !== context.project.revision ||
        captured.promptPath !== context.project.promptPath ||
        captured.profile?.id !== context.profile.id ||
        captured.profile?.version !== context.profile.version ||
        !context.profileDefinition ||
        captured.sourceHash !== (await sha256(context.sourceText ?? '')) ||
        captured.profileHash !== (await sha256(JSON.stringify(context.profileDefinition)))
      )
        return { kind: 'stale' };
      return {
        kind: 'ok',
        findings: body.findings,
        model: body.model,
        provenance: {
          ...context.project,
          sourceHash: captured.sourceHash,
          profileHash: captured.profileHash,
          provider: captured.provider,
        },
      };
    }
    return { kind: 'ok', findings: body.findings, model: body.model };
  } catch {
    return { kind: 'failed' };
  }
}

/** Requests a read-only compact interpretation of the complete assembled prompt. */
export async function requestCompactInterpretation(
  promptKey: string,
  text: string,
): Promise<CompactInterpretationOutcome> {
  try {
    const response = await postVerification({ mode: 'compact', promptKey, text });
    if (!response) return { kind: 'failed' };
    if (response.status === 503) return { kind: 'unavailable' };
    if (response.status === 429) return { kind: 'budget-exhausted' };
    if (!response.ok) return { kind: 'failed' };

    const body: unknown = await response.json();
    return isCompactOkBody(body)
      ? { kind: 'ok', compactText: body.compactText, model: body.model }
      : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
