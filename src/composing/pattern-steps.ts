import { WORKFLOW_PATTERNS } from '../design/workflow-patterns';

// These are authoring prompts for the built-in designs, not executable agent tasks.
const STEPS: Record<string, readonly [string, string, string][]> = {
  direct: [['prompt', 'Prompt', 'Describe the task, inputs, constraints and expected result.']],
  tools: [
    ['agent', 'Agent', 'Describe the goal and when a tool is needed.'],
    ['tool', 'Tool use', 'Name allowed tools, required arguments and how to handle failures.'],
    ['decision', 'Finish or escalate', 'Define completion evidence, a step limit and when to ask a human.'],
  ],
  sequential: [
    ['draft', 'Draft', 'Describe the first deliverable and inputs to use.'],
    ['review', 'Review', 'State the checks and evidence the draft must pass.'],
    ['polish', 'Polish', 'Explain how to use the review and format the final result.'],
  ],
  parallel: [
    ['split', 'Split work', 'Define independent tasks and the evidence each needs to return.'],
    ['research_a', 'Research A', 'Define the first research task, sources and output.'],
    ['research_b', 'Research B', 'Define the second research task, sources and output.'],
    ['combine', 'Combine', 'Describe how to reconcile conflicting evidence.'],
    ['verify', 'Verify', 'Set acceptance checks and when human review is required.'],
  ],
  routing: [
    ['route', 'Classify request', 'Define categories, routing criteria and the unknown-category fallback.'],
    ['specialist_a', 'Specialist A', 'Define this specialist’s task and expected output.'],
    ['specialist_b', 'Specialist B', 'Define this specialist’s task and expected output.'],
  ],
  handoff: [
    ['agent_a', 'Agent A', 'Define the initial task and when another specialist is needed.'],
    ['agent_b', 'Agent B', 'Define the handoff context, task and expected output.'],
    ['decision', 'Finish or escalate', 'Set completion evidence, a transfer limit and escalation instructions.'],
  ],
  review: [
    ['draft', 'Draft', 'Describe the initial deliverable.'],
    ['check', 'Check', 'Specify acceptance criteria and the evidence needed to pass.'],
    ['revise', 'Revise', 'Explain how to address findings, limit revisions and escalate unresolved issues.'],
  ],
  discussion: [
    ['moderator', 'Moderator', 'Define the goal, turn limit and how to coordinate participants.'],
    ['perspective_a', 'Perspective A', 'Define the first perspective and required evidence.'],
    ['perspective_b', 'Perspective B', 'Define the second perspective and required evidence.'],
    ['decision', 'Decision', 'Define agreement, conflict resolution and the escalation condition.'],
  ],
  adaptive: [
    ['plan', 'Plan and task ledger', 'Define the goal, task ledger, budget and replanning conditions.'],
    ['delegate', 'Delegate', 'Describe task allocation and the context each worker needs.'],
    ['work', 'Work', 'Define execution instructions and required evidence.'],
    ['check', 'Check', 'Specify completion checks and when to replan or ask a human.'],
  ],
};

export function patternSteps(workflow: string | undefined) {
  const pattern = WORKFLOW_PATTERNS.find((item) => item.graph.trim() === workflow?.trim());
  return pattern
    ? {
        pattern,
        steps: STEPS[pattern.id].map(([id, title, hint]) => ({ id, title, hint, tag: `step_${pattern.id}_${id}` })),
      }
    : null;
}
