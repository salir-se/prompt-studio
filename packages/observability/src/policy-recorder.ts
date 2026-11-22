/**
 * Policy decision recorder — wraps a pure policy invocation, captures
 * timing + input + output + reasoning, masks PII via `maskSensitiveData`,
 * and emits one `policy:decided` event on the supplied bus.
 *
 * The wrapped function's return value passes through unchanged so the
 * call site reads the same as before:
 *
 *     // Before:
 *     const passed = meetsScoreThreshold(score, 40);
 *
 *     // After (wrapped):
 *     const passed = recorder.record({
 *       policy: 'signal-score-gate',
 *       input: { score, threshold: 40 },
 *       invoke: () => meetsScoreThreshold(score, 40),
 *       reason: (allowed) => ({
 *         outcome: allowed ? 'allow' : 'block',
 *         reasoning: allowed
 *           ? `score ${score} ≥ threshold 40`
 *           : `score ${score} below threshold 40`,
 *       }),
 *       entityRef: { kind: 'signal', id: signalId },
 *       workspaceId,
 *     });
 *
 * See ADR-079 §"The capture pattern".
 */

import { maskSensitiveData } from './masking';
import type { PolicyDecision, PolicyEntityRef, PolicyId, PolicyOutcome } from './policy-types';
import { POLICY_VERSION_DEFAULT } from './policy-types';

/**
 * Loose shape of a recorded decision as it travels over the event bus.
 *
 * The strict `PolicyDecision` shape (with typed `policy`, `outcome`,
 * `entityRef.kind` unions) is what the recorder builds and what the
 * store stores; this widened shape is what the emitter/subscriber
 * contracts speak so they remain compatible with `@prompt-studio/events`
 * `EventBus` (which declares the same widened shape — see ADR-079 §
 * "The event") without forcing observability to depend on the events
 * package at runtime.
 */
export interface PolicyDecisionShape {
  id: string;
  policy: string;
  outcome: string;
  input: Record<string, unknown>;
  output: unknown;
  reasoning: string;
  entityRef: { kind: string; id: string };
  traceId?: string;
  policyVersion: string;
  workspaceId: string;
  timestamp: string;
  durationMs: number;
}

/**
 * Minimal emitter contract — what the recorder needs from any event
 * bus to publish a `policy:decided` event. Structurally satisfied by
 * `@prompt-studio/events` `EventBus` (and any other compatible bus) without
 * forcing observability to depend on @prompt-studio/events at runtime.
 */
export interface PolicyEventEmitter {
  emit(event: 'policy:decided', payload: { decision: PolicyDecisionShape }): void;
}

export interface PolicyReasoning {
  outcome: PolicyOutcome;
  reasoning: string;
}

export interface RecordPolicyArgs<TOutput> {
  policy: PolicyId;
  input: Record<string, unknown>;
  invoke: () => TOutput;
  reason: (output: TOutput) => PolicyReasoning;
  entityRef: PolicyEntityRef;
  workspaceId: string;
  traceId?: string;
  /** Defaults to 'v1'. Bump when the wrapped policy's semantics change. */
  policyVersion?: string;
}

export interface PolicyRecorder {
  record<TOutput>(args: RecordPolicyArgs<TOutput>): TOutput;
}

export interface CreatePolicyRecorderOptions {
  /** Override the clock — useful for deterministic tests. Default `Date.now`. */
  now?: () => number;
  /** Override the id generator — useful for deterministic tests. */
  generateId?: () => string;
  /** Override the masker — primarily for tests that need the raw payload. */
  mask?: <T>(payload: T) => T;
}

function defaultGenerateId(): string {
  return `pd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build a `PolicyRecorder` bound to the supplied `EventBus`. Every
 * successful `record()` call emits exactly one `policy:decided` event.
 *
 * If the wrapped `invoke()` throws, the error propagates to the caller
 * unchanged — and NO event is emitted. (The decision is recorded only
 * if a real decision was reached.)
 */
export function createPolicyRecorder(
  bus: PolicyEventEmitter,
  options: CreatePolicyRecorderOptions = {},
): PolicyRecorder {
  const now = options.now ?? Date.now;
  const generateId = options.generateId ?? defaultGenerateId;
  const mask = options.mask ?? maskSensitiveData;

  return {
    record<TOutput>(args: RecordPolicyArgs<TOutput>): TOutput {
      const startedAt = now();
      const output = args.invoke();
      const finishedAt = now();
      const { outcome, reasoning } = args.reason(output);

      const decision: PolicyDecision = {
        id: generateId(),
        policy: args.policy,
        outcome,
        input: mask(args.input),
        output: mask(output as unknown),
        reasoning,
        entityRef: args.entityRef,
        traceId: args.traceId,
        policyVersion: args.policyVersion ?? POLICY_VERSION_DEFAULT,
        workspaceId: args.workspaceId,
        timestamp: new Date(finishedAt).toISOString(),
        durationMs: Math.max(0, finishedAt - startedAt),
      };

      bus.emit('policy:decided', { decision });
      return output;
    },
  };
}
