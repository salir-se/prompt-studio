const microsoft = 'https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns';
const claude = 'https://code.claude.com/docs/en/workflows';
export const WORKFLOW_PATTERNS = [
  {
    id: 'direct',
    name: 'Direct prompt',
    description: 'One model call for a task that needs no tools or delegation.',
    source: microsoft,
    graph: 'flowchart LR\n  Request --> Prompt --> Result',
  },
  {
    id: 'tools',
    name: 'Agent with tools',
    description: 'One agent chooses tools and checks the result. Set a step limit.',
    source: microsoft,
    graph:
      'flowchart LR\n  Request --> Agent\n  Agent --> Decision{Tool needed?}\n  Decision -->|Yes, within step limit| Tool\n  Tool --> Agent\n  Decision -->|No| Result\n  Decision -->|Limit reached| Human[Human review]',
  },
  {
    id: 'sequential',
    name: 'Sequential steps',
    description: 'Use when each step needs the previous step’s output.',
    source: microsoft,
    graph: 'flowchart LR\n  Request --> Draft --> Review --> Polish --> Result',
  },
  {
    id: 'parallel',
    name: 'Parallel work (diamond)',
    description: 'Split independent work, combine the results, then verify the joined evidence.',
    source: 'https://x.com/AnatoliKopadze/article/2080668775796314331',
    graph:
      'flowchart LR\n  Request --> Split\n  Split --> ResearchA[Research A]\n  Split --> ResearchB[Research B]\n  ResearchA --> Combine\n  ResearchB --> Combine\n  Combine --> Verify{Evidence supports result?}\n  Verify -->|Yes| Result\n  Verify -->|No| Human[Human review]',
  },
  {
    id: 'routing',
    name: 'Routing',
    description: 'Choose a known specialist from the initial request.',
    source: microsoft,
    graph:
      'flowchart LR\n  Request --> Route{Classify request}\n  Route -->|Type A| SpecialistA[Specialist A]\n  Route -->|Type B| SpecialistB[Specialist B]\n  Route -->|Unknown| Human[Human review]\n  SpecialistA --> Result\n  SpecialistB --> Result',
  },
  {
    id: 'handoff',
    name: 'Agent handoff',
    description: 'Transfer control when another specialist is needed. Limit transfers.',
    source: microsoft,
    graph:
      'flowchart LR\n  Request --> AgentA[Agent A]\n  AgentA --> Decision{Can finish?}\n  Decision -->|Yes| Result\n  Decision -->|No, within transfer limit| AgentB[Agent B]\n  AgentB --> Result\n  Decision -->|Limit reached| Human[Human review]',
  },
  {
    id: 'review',
    name: 'Review and improve',
    description: 'Check against acceptance criteria, revise, and stop at a review limit.',
    source: claude,
    graph:
      'flowchart LR\n  Request --> Draft --> Check{Evidence and acceptance criteria met?}\n  Check -->|Yes| Result\n  Check -->|No, within review limit| Revise\n  Revise --> Check\n  Check -->|Limit reached| Human[Human review]',
  },
  {
    id: 'discussion',
    name: 'Group discussion',
    description: 'A moderator coordinates shared discussion toward a decision.',
    source: microsoft,
    graph:
      'flowchart LR\n  Request --> Moderator\n  Moderator --> SpecialistA[Perspective A]\n  Moderator --> SpecialistB[Perspective B]\n  SpecialistA --> Thread[Shared discussion]\n  SpecialistB --> Thread\n  Thread --> Decision{Agreement?}\n  Decision -->|Yes| Result\n  Decision -->|No, within turn limit| Moderator\n  Decision -->|Limit reached| Human[Human review]',
  },
  {
    id: 'adaptive',
    name: 'Adaptive planning',
    description: 'Maintain a task ledger, delegate work, and replan as evidence changes.',
    source: microsoft,
    graph:
      'flowchart LR\n  Request --> Plan[Plan and task ledger]\n  Plan --> Delegate --> Work --> Check{Goal reached?}\n  Check -->|Yes| Result\n  Check -->|No, within budget| Plan\n  Check -->|Stalled or budget reached| Human[Human review]',
  },
] as const;
