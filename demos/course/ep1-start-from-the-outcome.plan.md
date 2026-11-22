# Episode 1 — Start from the outcome: shot list

Narration: [`course-ep1-start-from-the-outcome.scenes.json`](../course-ep1-start-from-the-outcome.scenes.json). Shared setup, fake model and tool names: [README](README.md).

- **Goal on screen:** an empty project gets the `order-status` prompt with a mission, the `lookup_order` tool, the
  `customer_message` variable, and JSON Schema input and output contracts.
- **Start state:** a Git copy of `examples/order-status-start` at `DEMO_PROJECT_DIR` (default
  `~/order-status`). App on the welcome screen. Agent panel mounted, empty.
- **End state:** `prompts/order-status.md` holds only the Mission section (text below) and a design with a JSON input
  contract (one example) and a JSON output contract (schema, no examples yet). `.prompt-studio/project.json` holds
  `lookup_order` and `customer_message`.
- **MCP tools:** `list_documents`, `open_document`, `read_document` (shipped); `getDesign` (car 7).
- **Fake model:** not used in this episode.

Values used below:

- Tool description: `Look up one order by its ID. Returns status (processing, shipped, delayed, delivered or not_found), carrier, tracking number and dates.`
- Tool input schema: the `inputSchema` of `lookup_order` in `examples/order-status/.prompt-studio/project.json`.
- Variable purpose: `The customer message to answer, exactly as the customer wrote it. Untrusted text.`
- Variable example value: `Hi, where is my order ORD-10423? It was supposed to arrive this week.`
- Mission text (replaces the placeholder line inside `<mission>`):

  ```text
  You are the order-status assistant for {{company_name}}. You answer one customer message about one order.
  Tell the customer where their order is, using only facts that lookup_order returns. When those facts cannot answer the message, say so plainly and choose the next action that moves the case forward.
  ```

- Input JSON Schema and output JSON Schema: `design.input.jsonSchema` and `design.output.jsonSchema` of the finished
  prompt (decode the design comment at the end of `examples/order-status/prompts/order-status.md`, or call
  `readWorkspacePrompt`).
- Input example: `{"customer_message":"Hi, where is my order ORD-10423?","company_name":"Northwind Outfitters"}`

## course-intro

- **Agent panel:** empty. Header "AI agent · MCP client", tag "scripted session".
- **Person:** nothing; the welcome screen is visible.
- **Overlay:** headline card (episode 1 of 6) for the full scene.
- **Expected result:** the welcome screen with **Repository URL or filesystem path**.

## outcome-first

- **Agent panel:** `you` line: `Plan: an order-status assistant. Output for our support system: {reply, next_action, order_id}.`
- **Person:** no UI action; stay on the welcome screen.
- **Expected result:** unchanged screen; the narration carries the scene.

## open-project

- **Person:** click the path field, type `DEMO_PROJECT_DIR`, click **Open project**. The empty project opens.
  Click **New prompt**. In **Create a prompt**, type `Order status` in **Prompt title**; **Prompt ID** fills with
  `order-status`.
- **Expected result:** the dialog shows title and ID; no error.

## declare-dependencies

- **Person:** open **Inputs and tools**. Type `lookup_order` in **Tool**, the description in **Tool description**,
  and replace **Input JSON Schema** with the tool input schema. Type `customer_message` in **Variable**, the purpose
  in **Variable purpose**, the example in **Example value**. Click **Create prompt**.
- **Expected result:** the editor opens `order-status` in **Write** with the Mission placeholder. Explorer lists
  "Order status · 1 tool".

## state-the-job

- **Person:** in **Write**, select the placeholder line inside `<mission>` and type the mission text. Press
  Ctrl+S (**Apply changes**). Status reads **Saved on this computer**.
- **Expected result:** the mission text in the composer; the Explorer structure shows "01 Mission".

## input-contract

- **Person:** click **Design**. In **Expected input**, set **Input format** to **Structured JSON**. Replace
  **Input JSON schema** with the input schema. Readiness lists "Structured JSON input needs at least one valid
  example." In **Test structured JSON**, set **JSON contract to verify** to **Input**, paste the input example, click
  **Verify sample**, then **Use verified sample as example**.
- **Expected result:** the Readiness input issue disappears.

## output-contract

- **Person:** in **Expected output**, set **Output format** to **Structured JSON**, type the description
  `One JSON object: a reply for the customer, the next action, and the order ID used.`, replace **Output JSON
  schema** with the output schema. Readiness: "Structurally ready…". Click **Save prompt design**.
- **Overlay:** callout "Contract first: reply · next_action · order_id".
- **Expected result:** the footer reads "Structurally ready · Saved version"; close the panel.

## agent-sees-contract

- **Agent panel:**
  1. `cmd`: `claude mcp add prompt-studio -- bunx --package @salir/prompt-studio prompt-studio-mcp --stdio`
  2. `you`: `Read the order-status prompt in Prompt Studio and summarize its contract.`
  3. `tool`: `list_documents`
  4. `tool`: `open_document order-status`
  5. `tool`: `read_document order-status`
  6. `tool`: `getDesign order-status`
  7. `agent`: `One mission section so far. Input: customer_message and company_name. Output: reply, next_action (none | escalate | ask_for_order_id), order_id (ORD-12345 or null). Tool: lookup_order(order_id).`
- **MCP calls:** `list_documents {}`; `open_document {rootId: "order-status"}`;
  `read_document {rootId: "order-status"}`; `getDesign {rootId: "order-status"}`.
- **Fallback without car 7:** skip `getDesign`; the agent line ends after the tool sentence and the narration's
  "and reads the design" is cut by the editor.
- **Expected result:** the tab stays on `order-status` (the agent opened it).

## recap

- **Person:** click **Graph** so the single Mission node is visible.
- **Overlay:** lower third "Next: let the agent draft".
