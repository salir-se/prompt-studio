# Episode 4 — Contracts and tools: shot list

Narration: `ep4-contracts-and-tools.scenes.json`. Shared setup, fake model and tool names: [README](README.md).

- **Goal on screen:** a failing output sample, a passing one kept as an example, two more examples added by the
  agent; `company_name` added with the configuration lifecycle; one mocked run and one real MCP run with traces.
- **Start state:** end state of episode 3. Off camera, before `narration.startRecording`: start the fake model and
  the demo order service (README), and in **App settings** set provider **OpenAI-compatible**, model
  `local-test-model`, the fake model URL, and API key `local-test-key`.
- **End state:** design `output.examples` = the three examples of the finished design; project variables = the
  finished `project.json` variables; MCP server **Demo orders** registered.
- **MCP tools:** `verifySample`, `getDesign`, `setDesign` (car 7).
- **Fake model:** rule 3 of the README (run with tools).

Samples:

- `FAILING` = `{"reply":"Refund issued.","next_action":"refund","order_id":"10423"}`
- `PASSING` = `{"reply":"ORD-10423 shipped on 18 November with ParcelGo. Tracking number: PG-55821. Expected delivery: 21 November.","next_action":"none","order_id":"ORD-10423"}`
- `ASK` and `ESCALATE` = the second and third `output.examples` of the finished design.
- `MOCK_SHIPPED` = the `ORD-10423` row of the README's demo order service table.

## intro

- **Person:** open **Design** for the whole prompt (Explorer: click the prompt name first so no section is selected).
- **Overlay:** headline card (episode 4 of 6).

## sample-fails

- **Person:** scroll to **Test structured JSON**. Paste `FAILING` into **JSON sample to verify**. Click **Verify sample**.
- **Overlay:** callout "Verify a sample that should fail".
- **Expected result:** two errors: `output.next_action` is not one of the allowed values, and `output.order_id` does
  not match the pattern. **Use verified sample as example** does not appear.

## sample-passes

- **Person:** replace the sample with `PASSING`, click **Verify sample**, then **Use verified sample as example**.
- **Agent panel:**
  1. `you`: `Verify two more output samples, one for ask_for_order_id and one for escalate, and add them as examples.`
  2. `tool`: `verifySample order-status output` (twice)
  3. `tool`: `setDesign order-status "Add output examples"`
  4. `agent`: `Both samples pass the output schema. The contract now has three examples.`
- **MCP calls:** `verifySample {rootId: "order-status", axis: "output", sample: ASK}`;
  `verifySample {rootId: "order-status", axis: "output", sample: ESCALATE}`;
  `setDesign {rootId: "order-status", design: <current design with output.examples = [PASSING, ASK, ESCALATE]>, message: "Add output examples"}`.
- **Fallback without car 7:** the person verifies and adds both samples in the panel.
- **Expected result:** Readiness stays "Structurally ready"; **Advanced: complete versioned design** shows three
  output examples.

## variables

- **Person:** close Design. Click **Variables**. Show `customer_message` (purpose and sample). Click **Add variable**:
  name `company_name`, purpose `The shop name the assistant speaks for. Set once per deployment, not per request.`,
  sample `Northwind Outfitters`, lifecycle **configuration**. Save.
- **Expected result:** two variable cards, each "Used by: Order status".

## tool-definition

- **Person:** close Variables, click **Tools**. The `lookup_order` card shows the description; click **Edit** to show the input schema, then cancel.
- **Expected result:** the `order_id` property with `pattern` `^ORD-[0-9]{5}$`.

## mock-run

- **Person:**
  1. Press Alt+4 (**Run**). **Settings** tab → **Open app settings** → **MCP servers**: name `Demo orders`,
     **MCP endpoint URL** = the demo service URL, **Save server**, **Discover tools**. Close the dialog.
  2. **Single run** tab. Open **Tool responses · 0 selected**, choose `Demo orders / lookup_order`, add it. Keep
     **Execution mode** = **Predefined mock**; paste `MOCK_SHIPPED` into **Mock response (JSON)**.
  3. Fill `company_name` = `Northwind Outfitters`, `customer_message` = `Hi, where is ORD-10423?`.
     Click **Run prompt**.
- **Fake model:** first request has `tools` and no tool message, one ID → `tool_calls` `lookup_order
  {"order_id":"ORD-10423"}`. Second request has the tool message with `MOCK_SHIPPED` → final answer (shipped row).
- **Overlay:** lower third "Mocks first: repeatable runs".
- **Expected result:** output
  `{"reply":"ORD-10423 shipped on 18 November with ParcelGo. Tracking number: PG-55821. Expected delivery: 21 November.","next_action":"none","order_id":"ORD-10423"}`;
  **Tool call history**: `lookup_order`, Completed, **Arguments** `{"order_id":"ORD-10423"}`, "Predefined mock result".

## real-call

- **Person:** set **Execution mode** to **Real MCP call**. Replace `customer_message` with `Where is ORD-99999?`.
  Click **Run prompt**.
- **Fake model:** `tool_calls` `lookup_order {"order_id":"ORD-99999"}`; then, with the service result
  `{"order_id":"ORD-99999","status":"not_found"}`, the not-found answer.
- **Overlay:** lower third "Then a real MCP call, on purpose".
- **Expected result:** the status note about real tools is visible; output
  `{"reply":"I could not find order ORD-99999. Please check the ID in your confirmation email and send it again.","next_action":"ask_for_order_id","order_id":"ORD-99999"}`;
  **Tool call history** shows "MCP result".

## recap

- **Person:** scroll the run output so the JSON and the trace are both visible.
- **Overlay:** lower third "Next: verify and test".
