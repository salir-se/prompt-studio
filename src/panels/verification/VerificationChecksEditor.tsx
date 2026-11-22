import type {
  PromptDesign,
  PromptVerificationPrinciple,
  PromptVerificationProfile,
  PromptVerificationRule,
} from '@prompt-studio/prompts';
import { Button } from '@prompt-studio/ui/button';
import { Textarea } from '@prompt-studio/ui/textarea';
import { useEffect, useRef, useState } from 'react';
import { acceptedStatus, type CheckProposal, type ProposalStatus } from '../../verification/check-proposals';
import { ProposedChecks } from './ProposedChecks';
import { VerificationPresets } from './VerificationPresets';
import { VerificationRuleForm } from './VerificationRuleForm';
import { profilesForScope, revisedVerificationDesign, RULE_NAMES, ruleDescription } from './verification-editing';
import { appendVerificationRules, type VerificationPresetContext } from './verification-presets';

type RuleEditor = {
  profileId: string;
  index?: number;
  kind?: PromptVerificationRule['kind'];
  /** Editing an agent's proposed rule before accepting it. */
  proposal?: CheckProposal;
};
export type ResolveProposal = (
  id: string,
  status: Exclude<ProposalStatus, 'pending'>,
  saved?: PromptVerificationRule | PromptVerificationPrinciple,
) => void;
export function VerificationChecksEditor({
  profiles,
  design,
  scope,
  disabled,
  onSave,
  onDirtyChange,
  presetContext,
  proposals = [],
  onResolveProposal,
}: {
  profiles: readonly PromptVerificationProfile[];
  design?: PromptDesign;
  scope: string;
  disabled: boolean;
  onSave?: (design: PromptDesign) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  presetContext?: VerificationPresetContext;
  /** Pending agent proposals for this prompt; each shows under its profile until the person decides. */
  proposals?: readonly CheckProposal[];
  onResolveProposal?: ResolveProposal;
}) {
  const [draft, setDraft] = useState<PromptDesign | undefined>(design);
  const [baseline, setBaseline] = useState(JSON.stringify(design));
  const [ruleEditor, setRuleEditor] = useState<RuleEditor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savePending = useRef(false);
  const saveNotice = useRef<HTMLParagraphElement>(null);
  const errorNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) {
      errorNotice.current?.focus();
      errorNotice.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [error]);
  const attemptedSave = useRef<string | null>(null);
  const dirty = JSON.stringify(draft) !== baseline;
  const sourceKey = JSON.stringify(design);
  if (!dirty && !saving && sourceKey !== baseline) {
    setBaseline(sourceKey);
    setDraft(design);
  }
  const stale = sourceKey !== baseline && sourceKey !== JSON.stringify(draft) && sourceKey !== attemptedSave.current;
  useEffect(() => onDirtyChange(dirty || !!ruleEditor || saving), [dirty, ruleEditor, saving, onDirtyChange]);
  const displayedProfiles = profilesForScope(profiles, scope);
  const editableProfiles = profilesForScope(draft?.verificationProfiles ?? [], scope);
  const editable = !!draft && !!onSave;

  function changeProfile(id: string, update: (profile: PromptVerificationProfile) => PromptVerificationProfile) {
    setDraft((current) =>
      current
        ? {
            ...current,
            verificationProfiles: current.verificationProfiles.map((profile) =>
              profile.id === id ? update(profile) : profile,
            ),
          }
        : current,
    );
    setSaved(false);
  }
  function saveRule(rule: PromptVerificationRule) {
    if (!ruleEditor || !draft) return;
    const { profileId, index, proposal } = ruleEditor;
    const next = {
      ...draft,
      verificationProfiles: draft.verificationProfiles.map((profile) =>
        profile.id !== profileId
          ? profile
          : {
              ...profile,
              deterministicRules:
                index === undefined
                  ? [...profile.deterministicRules, rule]
                  : profile.deterministicRules.map((item, position) => (position === index ? rule : item)),
            },
      ),
    };
    setDraft(next);
    setSaved(false);
    setRuleEditor(null);
    void save(next).then((revised) => {
      if (proposal && revised) resolveAccepted(proposal, revised, rule.id);
    });
  }
  /** Marks a proposal accepted or edited with the check as the saved design holds it. */
  function resolveAccepted(proposal: CheckProposal, revised: PromptDesign, checkId: string) {
    const profile = revised.verificationProfiles.find((item) => item.id === proposal.profileId);
    const savedCheck =
      proposal.kind === 'rule'
        ? profile?.deterministicRules.find((item) => item.id === checkId)
        : profile?.principles.find((item) => item.id === checkId);
    onResolveProposal?.(proposal.id, acceptedStatus(proposal, savedCheck), savedCheck);
  }
  function acceptProposal(proposal: CheckProposal, statement?: string) {
    if (!draft) return;
    const check =
      proposal.kind === 'rule'
        ? proposal.rule
        : { ...proposal.criterion, statement: statement ?? proposal.criterion.statement };
    const next = {
      ...draft,
      verificationProfiles: draft.verificationProfiles.map((profile) =>
        profile.id !== proposal.profileId
          ? profile
          : proposal.kind === 'rule'
            ? { ...profile, deterministicRules: [...profile.deterministicRules, check as PromptVerificationRule] }
            : { ...profile, principles: [...profile.principles, check as PromptVerificationPrinciple] },
      ),
    };
    setDraft(next);
    setSaved(false);
    void save(next).then((revised) => {
      if (revised) resolveAccepted(proposal, revised, check.id);
    });
  }
  function addPreset(profileId: string, rules: readonly PromptVerificationRule[]) {
    if (!draft) return;
    const next = {
      ...draft,
      verificationProfiles: draft.verificationProfiles.map((profile) =>
        profile.id === profileId ? appendVerificationRules(profile, rules) : profile,
      ),
    };
    setDraft(next);
    setSaved(false);
    void save(next);
  }
  async function save(nextDraft = draft): Promise<PromptDesign | null> {
    if (
      !nextDraft ||
      !design ||
      !onSave ||
      JSON.stringify(nextDraft) === baseline ||
      savePending.current ||
      disabled ||
      stale
    )
      return null;
    savePending.current = true;
    setSaving(true);
    setError(null);
    try {
      if (
        nextDraft.verificationProfiles.some((profile) =>
          profile.principles.some((criterion) => !criterion.statement.trim()),
        )
      ) {
        setError('Describe each AI criterion before saving.');
        return null;
      }
      const revised = revisedVerificationDesign(design, nextDraft);
      // History can accept our design before durable storage fails; that is still our retryable draft.
      attemptedSave.current = JSON.stringify(revised);
      await onSave(revised);
      setDraft(revised);
      setBaseline(JSON.stringify(revised));
      setSaved(true);
      requestAnimationFrame(() => {
        saveNotice.current?.focus();
        saveNotice.current?.scrollIntoView({ block: 'nearest' });
      });
      return revised;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }
  return (
    <section
      aria-label="Verification check setup"
      className="space-y-5"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          !event.nativeEvent.isComposing &&
          event.key.toLowerCase() === 's'
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (!ruleEditor) void save();
        }
      }}
    >
      <div>
        <h3 className="text-sm font-semibold">Checks and AI criteria</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Automatic checks test specific requirements. AI criteria describe what a reviewer should assess.
        </p>
      </div>
      {!editable && (
        <p className="text-sm text-muted-foreground">
          These registered checks are read-only. Studio-authored prompts support editing their own checks.
        </p>
      )}
      {stale && (
        <p role="alert" className="text-sm text-destructive">
          The saved design changed. Copy your draft before discarding it and loading the latest checks.
        </p>
      )}
      {error && (
        <p ref={errorNotice} tabIndex={-1} role="alert" className="text-sm text-destructive">
          {error} Your draft is retained.
        </p>
      )}
      <fieldset disabled={saving || disabled} className="min-w-0 space-y-5">
        {displayedProfiles.map((canonical) => {
          const profile = editableProfiles.find((item) => item.id === canonical.id);
          const persisted = design?.verificationProfiles.find((item) => item.id === canonical.id);
          const active = profile ?? canonical;
          const rules = [
            ...active.deterministicRules,
            ...canonical.deterministicRules.filter(
              (rule) => !(persisted ?? active).deterministicRules.some((item) => item.id === rule.id),
            ),
          ];
          const derived = canonical.principles.filter(
            (criterion) => !(persisted ?? active).principles.some((item) => item.id === criterion.id),
          );
          return (
            <section key={canonical.id} className="min-w-0 space-y-3 rounded-lg border border-border p-4">
              {editable && profile && (
                <ProposedChecks
                  proposals={proposals.filter(
                    (proposal) => proposal.profileId === profile.id && proposal.status === 'pending',
                  )}
                  disabled={saving || disabled || stale || !!ruleEditor}
                  onAccept={acceptProposal}
                  onEditRule={(proposal) => setRuleEditor({ profileId: profile.id, proposal })}
                  onReject={(proposal) => onResolveProposal?.(proposal.id, 'rejected')}
                />
              )}
              <section aria-label="Automatic checks" className="space-y-3">
                <div>
                  <h4 className="text-sm font-semibold">Automatic checks</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Test explicit rules against the source. Passing does not prove instruction quality.
                  </p>
                </div>
                {editable && profile && presetContext && (
                  <VerificationPresets
                    context={presetContext}
                    rules={rules}
                    disabled={saving || disabled || stale || !!ruleEditor}
                    onAdd={(rules) => addPreset(profile.id, rules)}
                    onCustom={(kind) => setRuleEditor({ profileId: profile.id, kind })}
                  />
                )}
                <ul aria-label="Section rules" className="space-y-3">
                  {rules.map((rule) => {
                    const index = profile?.deterministicRules.findIndex((item) => item.id === rule.id) ?? -1;
                    return (
                      <li key={rule.id} className="min-w-0 space-y-2 border-b border-border pb-3">
                        <p className="text-sm font-medium">{RULE_NAMES[rule.kind]}</p>
                        <p className="break-words text-sm text-muted-foreground">{ruleDescription(rule)}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>
                            {rule.severity} · {rule.enforcement}
                          </span>
                          {index < 0 ? (
                            <span>Provided by Studio</span>
                          ) : (
                            <span>
                              {['non-empty', 'known-placeholder'].includes(rule.kind)
                                ? 'Basic check'
                                : 'Authored check'}
                            </span>
                          )}
                          {editable && profile && index >= 0 && (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!!ruleEditor}
                                aria-label={`Edit ${RULE_NAMES[rule.kind]}`}
                                onClick={() => setRuleEditor({ profileId: profile.id, index })}
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={!!ruleEditor}
                                aria-label={`Remove ${RULE_NAMES[rule.kind]}`}
                                onClick={() =>
                                  changeProfile(profile.id, (item) => ({
                                    ...item,
                                    deterministicRules: item.deterministicRules.filter(
                                      (_, position) => position !== index,
                                    ),
                                  }))
                                }
                              >
                                Remove
                              </Button>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {editable && profile && !ruleEditor && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRuleEditor({ profileId: profile.id })}
                  >
                    Add automatic check
                  </Button>
                )}
                {ruleEditor?.profileId === canonical.id && (
                  <VerificationRuleForm
                    key={`${ruleEditor.profileId}-${ruleEditor.index ?? ruleEditor.proposal?.id ?? 'new'}`}
                    initialKind={ruleEditor.kind}
                    rule={
                      ruleEditor.index !== undefined
                        ? profile?.deterministicRules[ruleEditor.index]
                        : ruleEditor.proposal?.kind === 'rule'
                          ? ruleEditor.proposal.rule
                          : undefined
                    }
                    onSave={saveRule}
                    onCancel={() => setRuleEditor(null)}
                  />
                )}
              </section>
              <section aria-label="AI review criteria" className="space-y-3 border-t pt-4">
                <div>
                  <h4 className="text-sm font-semibold">AI review criteria</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Describe what the optional model review should assess. Save before running AI review.
                  </p>
                </div>
                <ul aria-label="Section principles" className="space-y-3">
                  {active.principles.map((criterion, index) => (
                    <li key={criterion.id} className="space-y-2 border-b border-border pb-3">
                      {editable && profile && criterion.owner === 'configuration' ? (
                        <>
                          <label htmlFor={`criterion-${criterion.id}`} className="block text-sm">
                            Criterion {index + 1}
                            <Textarea
                              id={`criterion-${criterion.id}`}
                              aria-label={`AI criterion ${index + 1}`}
                              className="mt-1 min-h-20 text-sm"
                              value={criterion.statement}
                              onChange={(event) =>
                                changeProfile(profile.id, (item) => ({
                                  ...item,
                                  principles: item.principles.map((value) =>
                                    value.id === criterion.id ? { ...value, statement: event.target.value } : value,
                                  ),
                                }))
                              }
                            />
                          </label>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove AI criterion ${index + 1}`}
                            onClick={() =>
                              changeProfile(profile.id, (item) => ({
                                ...item,
                                principles: item.principles.filter((value) => value.id !== criterion.id),
                              }))
                            }
                          >
                            Remove criterion
                          </Button>
                        </>
                      ) : (
                        <p className="break-words text-sm">{criterion.statement}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {criterion.owner === 'platform'
                          ? 'Protected criterion · platform · read-only'
                          : 'Authored criterion'}{' '}
                        · {criterion.allowedCustomization}
                      </p>
                    </li>
                  ))}
                </ul>
                {!!derived.length && (
                  <details className="text-sm">
                    <summary className="cursor-pointer">
                      Criteria derived from Design contracts · {derived.length}
                    </summary>
                    <ul className="mt-3 space-y-3">
                      {derived.map((criterion) => (
                        <li key={criterion.id} className="break-words text-sm">
                          {criterion.statement}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Edit input, workflow and output in Design to change these criteria.
                    </p>
                  </details>
                )}
                {editable && profile && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      changeProfile(profile.id, (item) => ({
                        ...item,
                        principles: [
                          ...item.principles,
                          {
                            id: `criterion-${crypto.randomUUID()}`,
                            version: 1,
                            owner: 'configuration',
                            statement: '',
                            severity: 'warning',
                            allowedCustomization: 'The prompt author may revise this criterion.',
                            sectionIds: profile.scope === 'section' ? [profile.sectionId] : [],
                          },
                        ],
                      }))
                    }
                  >
                    Add AI criterion
                  </Button>
                )}
              </section>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Profile details</summary>
                <p className="mt-2 break-all">
                  {canonical.id} · version {canonical.version}
                </p>
                {!!canonical.dependsOn?.length && (
                  <p className="break-all">Dependencies: {canonical.dependsOn.join(', ')}</p>
                )}
              </details>
            </section>
          );
        })}
        {!displayedProfiles.length && (
          <p className="text-sm text-muted-foreground">No checks are registered for this scope.</p>
        )}
      </fieldset>
      {editable && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card py-3">
          <p ref={saveNotice} tabIndex={-1} role="status" className="text-xs text-muted-foreground">
            {saving
              ? 'Saving checks…'
              : dirty
                ? 'Unsaved check definitions'
                : saved
                  ? 'Checks saved and rechecked'
                  : 'Current check definitions'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={(!dirty && !ruleEditor) || saving}
              onClick={() => {
                setDraft(design);
                setBaseline(sourceKey);
                setRuleEditor(null);
                setError(null);
              }}
            >
              Discard check edits
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!dirty || !!ruleEditor || saving || disabled || stale}
              onClick={() => void save()}
            >
              Save checks and recheck
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
