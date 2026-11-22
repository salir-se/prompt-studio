import type { VerificationCheckStatus } from '@prompt-studio/prompt-graph-ui';
import type { PromptVerificationFinding } from '@prompt-studio/prompts';
import { useRef, useState } from 'react';
import type { VerificationRunResult, VerificationSectionResult } from '../root-verification';
import {
  type ProjectReviewContext,
  type ProjectReviewProvenance,
  requestSemanticVerification,
} from '../semantic-verification-client';
import { WHOLE_PROMPT } from './verification-editing';

export type SemanticReviewState = {
  status: 'idle' | 'loading' | 'results' | 'unavailable' | 'budget-exhausted' | 'failed' | 'stale' | 'busy';
  findings: readonly PromptVerificationFinding[];
  model: string | null;
  provenance?: ProjectReviewProvenance;
  reviewedAt?: string;
};
export const IDLE_REVIEW: SemanticReviewState = { status: 'idle', findings: [], model: null };
type Entry = { identity: string; sectionId: string; review: SemanticReviewState };

/** The editor owns this session so closing a panel cannot erase review evidence. */
export function useSemanticReview(
  result: VerificationRunResult | null,
  project?: ProjectReviewContext,
  ownerId?: string,
) {
  const previousOwner = useRef('');
  const owner = project
    ? `${project.projectId}:${project.promptPath}`
    : (ownerId ?? result?.promptKey ?? previousOwner.current);
  previousOwner.current = owner;
  const identity = result ? JSON.stringify([owner, result.promptKey, result.text, result.profiles]) : null;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const pending = useRef(false);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const keyFor = (sectionId: string) => `${owner}:${sectionId}`;
  const active = Object.values(entries).filter((entry) => entries[keyFor(entry.sectionId)] === entry);
  const statusBySectionId = Object.fromEntries(
    active.map((entry) => [
      entry.sectionId,
      entry.review.status === 'results' ? (entry.identity === identity ? 'current' : 'stale') : 'not-checked',
    ]),
  ) as Record<string, VerificationCheckStatus>;
  return {
    busy: pending.current,
    statusBySectionId,
    forSection: (section?: VerificationSectionResult) => {
      const entry = section
        ? entries[keyFor(section.profile.scope === 'section' ? section.sectionId : WHOLE_PROMPT)]
        : undefined;
      return entry?.identity === identity ? entry.review : IDLE_REVIEW;
    },
    async run(section: VerificationSectionResult) {
      if (!result || pending.current || !section.profile.principles.length || !identity) return;
      const requestIdentity = identity;
      const sectionId = section.profile.scope === 'section' ? section.sectionId : WHOLE_PROMPT;
      const key = keyFor(sectionId);
      pending.current = true;
      setEntries((current) => ({
        ...current,
        [key]: { identity, sectionId, review: { ...IDLE_REVIEW, status: 'loading' } },
      }));
      const outcome = await requestSemanticVerification(result.promptKey, section.text, {
        profile: { id: section.profile.id, version: section.profile.version },
        sectionId: section.sectionId,
        principles: section.profile.principles,
        dependencies: section.dependencies,
        ...(project ? { project, sourceText: result.text, profileDefinition: section.profile } : {}),
      });
      pending.current = false;
      if (currentIdentity.current !== requestIdentity) {
        setEntries((current) => {
          const next = { ...current };
          if (next[key]?.review.status === 'loading') delete next[key];
          return next;
        });
        return;
      }
      const review: SemanticReviewState =
        outcome.kind === 'ok'
          ? {
              status: 'results',
              findings: outcome.findings,
              model: outcome.model,
              ...(outcome.provenance ? { provenance: outcome.provenance } : {}),
              reviewedAt: new Date().toISOString(),
            }
          : { ...IDLE_REVIEW, status: outcome.kind };
      setEntries((current) => ({ ...current, [key]: { identity, sectionId, review } }));
    },
  };
}
export type SemanticReviewSession = ReturnType<typeof useSemanticReview>;
