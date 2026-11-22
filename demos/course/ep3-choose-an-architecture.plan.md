# Episode 3 — Choose an architecture: shot list

Narration: `ep3-choose-an-architecture.scenes.json`. Shared setup, fake model and tool names: [README](README.md).

- **Goal on screen:** the person picks a workflow pattern; the agent applies it and tailors the major workflow; the
  Tool use section gets its own sub-prompt design.
- **Start state:** end state of episode 2 (prompt text = finished text without Examples; design from episode 1).
- **End state:** design `workflow` = the finished design's `workflow`; `sectionDesigns` = the finished design's
  entries for the five sections that exist (all except `order-status.examples`). Readiness: structurally ready.
- **MCP tools:** `listWorkflowPatterns`, `applyWorkflowPattern`, `getDesign`, `setDesign` (car 7).
- **Fake model:** not used in this episode.

`FINISHED_DESIGN` below is the design decoded from `examples/order-status/prompts/order-status.md`.

## intro

- **Person:** **Graph** visible.
- **Overlay:** headline card (episode 3 of 6).

## pattern-catalog

- **Person:** click **Design**. Scroll to **Major workflow** (default diagram: Input → Prompt → Output). Click
  **Choose pattern**. In **Choose a workflow pattern**, move the cursor slowly over Direct prompt, Agent with tools,
  Routing, and Review and improve so each preview is visible.
- **Expected result:** the pattern dialog with graph previews.

## choose

- **Person:** select **Agent with tools**, click **Use pattern**.
- **Overlay:** callout "The smallest pattern that does the job".
- **Expected result:** the Workflow preview shows Request → Agent → "Tool needed?" with the step-limit and
  "Human review" branches. Click **Save prompt design**.

## agent-tailors

- **Agent panel:**
  1. `you`: `Make the major workflow specific to this prompt: route by the number of order IDs, look up, compose from tool facts, verify or escalate.`
  2. `tool`: `listWorkflowPatterns`
  3. `tool`: `applyWorkflowPattern order-status tools`
  4. `tool`: `setDesign order-status "Tailor the major workflow"`
  5. `agent`: `Workflow saved: every branch ends in the JSON reply. Not found and zero or several IDs go to "Ask for the order ID".`
- **MCP calls:** `listWorkflowPatterns {}`;
  `applyWorkflowPattern {rootId: "order-status", patternId: "tools"}`;
  `setDesign {rootId: "order-status", design: <current design with workflow = FINISHED_DESIGN.workflow>, message: "Tailor the major workflow"}`.
- **Fallback without car 7:** the person pastes `FINISHED_DESIGN.workflow` into **Major workflow Mermaid** and saves;
  the agent panel shows only the `you` and `agent` lines.
- **Expected result:** the Workflow preview redraws with Customer message → "How many order IDs?" → … → JSON reply.

## read-diagram

- **Person:** click the Workflow preview to enlarge it if the build supports it; otherwise scroll so the preview
  fills the panel. Move the cursor along the three exits: Ask for the order ID, Escalate to a person, JSON reply.
- **Effect:** spotlight on the Workflow preview (4 s).

## sub-prompt

- **Person:** close Design. In Explorer, click **03 Tool use**, then **Design**. The panel title reads
  **Sub-prompt design** with `order-status.tool_use`.
- **Agent panel:**
  1. `you`: `Set sub-prompt designs for every section. Tool use outputs one lookup_order call.`
  2. `tool`: `getDesign order-status`
  3. `tool`: `setDesign order-status "Sub-prompt designs for each section"`
  4. `agent`: `Five sub-prompt designs saved. Tool use: input is the customer message, output is a tool call to lookup_order.`
- **MCP calls:** `getDesign {rootId: "order-status"}`;
  `setDesign {rootId: "order-status", design: <current design with sectionDesigns = FINISHED_DESIGN.sectionDesigns minus order-status.examples>, message: "Sub-prompt designs for each section"}`.
- **Fallback without car 7:** paste the target design into **Advanced: complete versioned design** and save.
- **Overlay:** lower third "Each section has its own input and output".
- **Expected result:** **Expected output** shows **Tool call** with **Required tool name** `lookup_order`; the
  sub-prompt workflow preview shows the ID-count branch.

## readiness

- **Person:** scroll to **Readiness**.
- **Expected result:** "Structurally ready. Mermaid syntax is previewed here and checked before saving."

## recap

- **Person:** close Design; **Graph** visible.
- **Overlay:** lower third "Next: contracts and tools".
