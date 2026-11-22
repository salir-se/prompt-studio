# Use Prompt Studio with your AI agent (MCP)

[Back to README](../README.md)

Prompt Studio has an MCP server. Your coding agent (Claude Code, Codex, or any other MCP client) reads and
edits prompts through it, and every change appears live in the Prompt Studio tab in your browser. You keep
working in the agent's chat; Prompt Studio shows you the prompt's structure, variables, and checks while the
agent works, so you can review the result and ask for the next change.

## How it fits together

```
 you ──chat──▶ AI agent (Claude Code, Codex, …)
                  │  MCP tools
                  ▼
           prompt-studio-mcp ──WebSocket──▶ Prompt Studio server ──▶ the open browser tab
                                                                          (graph, Write, Verify, Run)
```

- The MCP server drives the **open editor tab**: start Prompt Studio and keep one tab open on your project. It
  keeps one WebSocket connection to Prompt Studio and opens it again when it drops
  ([protocol](remote-control.md)).
- Edits land through the editor's normal save path, so each one becomes a commit in the project history and
  can be restored.
- The MCP server and Prompt Studio authenticate with the per-launch control token. Local clients read it from a
  `0600` file in the system temp folder; you only set `PROMPT_STUDIO_CONTROL_TOKEN` when the two run in
  different places (for example Prompt Studio in Docker and the MCP server on the host).

## Tools

| Tool | What it does |
|---|---|
| `list_documents` | Lists every prompt and skill in the open project. |
| `open_document` | Opens a document in the editor tab. |
| `read_document` | Returns a document's text (the working copy when it is open). |
| `edit_document` | Replaces the open document's text and saves it as a commit. |
| `history` | Lists a document's commits, newest first. |
| `reset_document` | Resets the open document to its baseline text (a new commit). |
| `list_configurations`, `create_configuration`, `switch_configuration` | Manage named configurations of the project. |
| `list_targets` | Lists the open editor tabs: `browserId`, whether each is ready, its project, open document and view. |

### Sections

The section tools work on one section of the **open** document, the way the outline and the graph do. Each edit is
one commit, and the person sees the graph and the outline change while the agent works.

| Tool | What it does |
|---|---|
| `list_sections` | Lists the sections in document order: `id`, `title`, `depth`, `parentId`, `index` among siblings, delimiter kind (`xml-tag`, `atx-heading`, `caps-label`), `childIds` and the `{{variables}}` each uses. |
| `read_section` | Returns one section's own body (without its heading or tags and without its sub-sections). |
| `edit_section` | Replaces one section's own body. The heading or tags, its sub-sections and every other section stay byte-identical. |
| `insert_section` | Inserts a section after another one (`position: "after"`) or as its first sub-section (`"firstChild"`), with a tag name and an optional body. Returns the new section's id. |
| `move_section` | Moves a section one place `up` or `down` among its siblings, with its sub-sections. |
| `remove_section` | Removes a section and its sub-sections. The person can undo it or restore it from History. |

Section ids come from `list_sections`. A nested section's id is its path (`tools/retry`). For an XML section, its
tag (`output_format`) also works. An unknown id fails with `missing_target` and asks the agent to list sections.

### Evaluations

Open the project prompt first. These tools use its saved suites and the model selected in Run Settings. A run
appears in the editor's **Evaluations** panel and uses the saved Run profile's skills and tool bindings.

| Tool | What it does |
|---|---|
| `list_suites` | Lists the open prompt's saved suites and case IDs. |
| `run_suite` | Starts a saved `suiteId` against the current prompt or its unapplied draft. Requires `allowPaidRun: true`. |
| `get_evaluation_results` | Reads the run by its `evaluationId`, including its status and per-case check results. |
| `compare_versions` | Runs the same saved `suiteId` on `baselineTag` and `candidateTag`. Omit `candidateTag` to compare with the current draft. Requires `allowPaidRun: true`. |

Both start commands return an ID as soon as the evaluation is queued. Set `allowPaidRun: true` only after the
person authorizes using their configured model. When comparing, each test case runs against both versions.

### Live editor resources

Call `resources/list` to discover `studio://editor/<browserId>/document`, `sections`, `findings`, and `events`
for each ready tab. `document` and `sections` include unapplied writing. `findings` shows the latest state from
Verify. `events` lists up to 20 recent editor actions, including changes to writing, saved checks and saved versions.

Launch `prompt-studio-mcp --stdio` to subscribe to an individual resource with `resources/subscribe`. When it
changes, the client receives `notifications/resources/updated` with the URI and can call `resources/read` for the
latest content. Use `resources/unsubscribe` to stop updates. Streamable HTTP supports discovery and reads.

### Design contracts and workflow patterns

A design records, for the whole prompt and for each section, the expected **input** (free text, or JSON with a JSON
Schema), the **workflow** (a Mermaid flowchart) and the expected **output** (free text, a tool call, or JSON with a
JSON Schema). Only prompts created or adopted in Prompt Studio have a design.

| Tool | What it does |
|---|---|
| `get_design` | Returns the input contract, workflow and output contract of the whole prompt, or of one section with `sectionId`, plus the readiness issues shown in **Design**. |
| `set_design` | Changes the input, workflow and/or output of one scope and saves a new design version. It is checked like the Design panel's **Save**: an invalid contract, an example that does not match its schema, a readiness issue or a workflow Mermaid cannot render fails with `invalid_input` and the validator's messages, and nothing is saved. The Design panel then opens on that scope. |
| `verify_sample` | Checks a JSON sample (for example a model reply) against the scope's JSON output contract, or its input contract with `contract: "input"`. The same check as **Verify sample**. Changes nothing. |
| `list_workflow_patterns` | Lists the pattern catalog of the Design panel's **Choose pattern** dialog: id, name, when to use it, Mermaid graph. |
| `apply_workflow_pattern` | Sets one scope's workflow to a pattern's graph and saves the design. It records the workflow only; nothing runs. |

### Verification

The agent can run the automatic checks and read findings, but **only the person saves checks**. The agent
proposes; the person decides in **Verify → Checks & criteria**. AI review is a paid model call, so only the person
starts it in **Verify → AI review**; the agent reads its results.

| Tool | What it does |
|---|---|
| `list_checks` | Lists the automatic checks and AI review criteria per scope (`sectionId: null` is the whole prompt), with state `saved` or `proposed` and their origin (authored, studio, derived from design, platform). |
| `run_checks` | Runs the automatic checks (the **Verify** button) and returns the findings. Opens Verify → Findings. |
| `get_findings` | Returns the latest automatic findings and the AI review results per scope, each with freshness: `current`, `stale` (from an older text or older checks), `none` or `not-checked`. |
| `propose_check` | Proposes an automatic check (`kind: "rule"`, for example `{ "kind": "required-tool", "name": "lookup_order" }`) or an AI review criterion (`kind: "criterion"` with a `statement`). It is **not saved**: it appears in Checks & criteria marked **Proposed**. Returns a `proposalId` with status `proposed`. |
| `get_proposal_status` | Returns `pending`, `accepted` (saved as proposed), `edited` (the person changed it before saving; the saved version is included) or `rejected`. |

In Checks & criteria, each proposal has **Accept proposal**, **Edit proposal** (automatic checks open the check
form; a criterion's wording is editable in place) and **Reject proposal**. Proposals live in the editor tab: a
reload drops the undecided ones.

Edits and resets apply to the **open** document, so agents call `open_document` first.

Every tool except `list_targets` takes an optional `browserId`. With one tab open, leave it out. With several
tabs open, a call without it fails and the error lists the tabs; the agent calls `list_targets` and passes the
`browserId` of the tab you work in.

## Set up

Start Prompt Studio first (`prompt-studio`, `bunx @salir/prompt-studio`, or Docker) and open your project in
the browser. Then register the MCP server with your agent.

### Claude Code

```bash
claude mcp add prompt-studio -- bunx --package @salir/prompt-studio prompt-studio-mcp --stdio
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.prompt-studio]
command = "bunx"
args = ["--package", "@salir/prompt-studio", "prompt-studio-mcp", "--stdio"]
```

### Any MCP client

- **stdio:** run `bunx --package @salir/prompt-studio prompt-studio-mcp --stdio` as the server command.
- **Streamable HTTP:** run `bunx --package @salir/prompt-studio prompt-studio-mcp` (listens on
  `http://127.0.0.1:5274/mcp`) and send `Authorization: Bearer <control token>`.

### Prompt Studio in Docker

The token file lives inside the container, so run the MCP server there too:

```bash
claude mcp add prompt-studio -- docker exec -i <container-name> bun mcp/main.js --stdio
```

Start the container with `--name <container-name>` so the command can find it.

### From a source checkout

```bash
claude mcp add prompt-studio -- bun /path/to/prompt-studio/packages/mcp-server/src/index.ts --stdio
```

## A typical session

1. In Prompt Studio, open your project and keep the tab visible next to the agent.
   The agent works in small steps: `open_document` → `list_sections` → `read_section` → `edit_section` or
   `insert_section` → `list_sections` again to check the new structure. For contracts: `get_design` →
   `set_design` (for example a JSON output schema) → `verify_sample` with a realistic reply →
   `apply_workflow_pattern` for a section's workflow. For checks: `run_checks` → `list_checks` →
   `propose_check` → ask the person to review it → `get_proposal_status`.
2. Ask the agent: *"Use prompt-studio to create a support triage prompt with mission, categories, urgency and a
   JSON output format."* Watch the sections appear in Explorer and the graph.
3. Review the structure in **Graph** and **Verify**. Tell the agent what to change: *"Add an urgent level for
   security reports and a check that the output is valid JSON."*
4. Run the prompt and its test suite in **Run** and **Evaluations**, save a version, and open a pull request
   from **Share**.

## Limits

- Evaluations (test suites and runs) through MCP are planned; see the
  [roadmap issues](https://github.com/salir-se/prompt-studio/issues?q=is%3Aissue+label%3Amcp).
- Commands relay through the open tab. With no tab open, tools answer with an error that asks you to open one.
- If a tab disconnects or does not answer in time, the error says the command may have run; the agent should
  read the document before it retries an edit.
- HTTP request bodies are limited to 2 MiB + 4 KiB, and tool arguments to 10,000 structural elements.
