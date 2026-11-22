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

Edits and resets apply to the **open** document, so agents call `open_document` first.

Every tool except `list_targets` takes an optional `browserId`. With one tab open, leave it out. With several
tabs open, a call without it fails and the error lists the tabs; the agent calls `list_targets` and passes the
`browserId` of the tab you work in.

## Set up

Start Prompt Studio first (`prompt-studio`, `bunx @salir-se/prompt-studio`, or Docker) and open your project in
the browser. Then register the MCP server with your agent.

### Claude Code

```bash
claude mcp add prompt-studio -- bunx --package @salir-se/prompt-studio prompt-studio-mcp --stdio
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.prompt-studio]
command = "bunx"
args = ["--package", "@salir-se/prompt-studio", "prompt-studio-mcp", "--stdio"]
```

### Any MCP client

- **stdio:** run `bunx --package @salir-se/prompt-studio prompt-studio-mcp --stdio` as the server command.
- **Streamable HTTP:** run `bunx --package @salir-se/prompt-studio prompt-studio-mcp` (listens on
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
2. Ask the agent: *"Use prompt-studio to create a support triage prompt with mission, categories, urgency and a
   JSON output format."* Watch the sections appear in Explorer and the graph.
3. Review the structure in **Graph** and **Verify**. Tell the agent what to change: *"Add an urgent level for
   security reports and a check that the output is valid JSON."*
4. Run the prompt and its test suite in **Run** and **Evaluations**, save a version, and open a pull request
   from **Share**.

## Limits

- The tools work on whole documents. Section-level edits, design contracts, verification rules and
  evaluations through MCP are planned; see the
  [roadmap issues](https://github.com/salir-se/prompt-studio/issues?q=is%3Aissue+label%3Amcp).
- Commands relay through the open tab. With no tab open, tools answer with an error that asks you to open one.
- If a tab disconnects or does not answer in time, the error says the command may have run; the agent should
  read the document before it retries an edit.
- HTTP request bodies are limited to 2 MiB + 4 KiB, and tool arguments to 10,000 structural elements.
