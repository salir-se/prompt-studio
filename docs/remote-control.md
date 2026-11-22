# Remote control over WebSocket

[Back to README](../README.md)

Prompt Studio can be driven from outside the browser: the `ps` CLI ([docs/cli.md](cli.md)), the MCP server
([docs/mcp.md](mcp.md)) and your own scripts send commands, and an **open editor tab** runs them with the same
handlers its buttons use. This page describes how Prompt Studio adopts the reusable specification "Remote
control of a Web application through a CLI over WebSocket" (requirements RC-01 to RC-40, acceptance tests
AT-01 to AT-20). Phase 1 is implemented; the status table at the end says which items are verified and which
are not implemented yet.

## How it fits together

```
 ps CLI ─┐                                   ┌─▶ editor tab A (browserId tab-…)
 MCP ────┼─ controller ─▶ /__control/ws ─────┤
 script ─┘   (WebSocket)   gateway in the    └─▶ editor tab B
                           Studio server        (browser role, same WebSocket endpoint)
```

- **Endpoint:** `ws://127.0.0.1:<port>/__control/ws` on the Studio server (the dev server and the standalone
  server both serve it; default port `5273`).
- **Roles:** an editor tab connects as `browser`; the CLI, the MCP server and scripts connect as `controller`.
- **Executor:** every Phase 1 command runs in a tab. The gateway validates, routes and relays; it never edits a
  document itself, so the tab's state stays the single source of truth.

## Trust model

| Control | What it does |
|---|---|
| Loopback binding | The Studio listens on `127.0.0.1` by default. Keep it there; the channel can change the open editor. |
| Origin check | An upgrade request whose `Origin` header is present and not one of the Studio's own origins is refused with HTTP 403 before a WebSocket exists. Browsers always send `Origin`, so another web page cannot connect. The CLI and the MCP server send no `Origin`. |
| Token in `hello` | A connection is unauthenticated until its first message, `hello`, carries the control token. It must arrive within 5 seconds (else close `4408`). A wrong token closes the socket with `4401` and no error text. The comparison is timing-safe. |
| Token source | The per-launch token: the editor tab reads it from the page's `studio-token` meta tag; local clients read it from `<tmpdir>/prompt-studio-control-<port>.token` (mode `0600`), or from `PROMPT_STUDIO_CONTROL_TOKEN`, or `--token`. |
| Result ownership | The gateway accepts a command's result only from the tab it routed the command to. A result from another tab is logged and ignored. |
| Logs | The gateway logs event names, ids, actions and error codes. It never logs the token or command parameters. |

## Handshake

The first message on every connection is `hello`:

```json
{ "type": "hello", "role": "controller", "protocolVersions": ["1.0"], "token": "<control token>" }
```

The gateway picks the first version it supports that the peer offers. With no common version it sends an
`error` with code `unsupported_version` and closes with `4426`, before any command can run. Otherwise it
answers `welcome` with the negotiated `protocolVersion`, the command catalog (names, descriptions, JSON Schema
of the parameters, side effects, completion levels) and the limits. `ps capabilities` prints that catalog.

## Target identity

- Each editor tab gets a `browserId` (for example `tab-3f2a…`) in its `welcome`.
- The tab keeps the id in `sessionStorage` and asks for it again after a reload (`resumeBrowserId`). The gateway
  grants it only when no live socket holds that id; otherwise the tab gets a new one. A second tab never takes
  over the first tab's id.
- Each tab reports its state: `ready` (its history has loaded), the project id and name, the open document id
  and the active view (`write` or `graph`). It sends `state.update` whenever one of these changes.
- `ps targets` (or the `list_targets` MCP tool) lists the tabs with this state.

**Target selection.** A command may name a tab (`target.browserId`; CLI `--target`; MCP `browserId`).

| Situation | Result |
|---|---|
| Named tab exists and is ready | Runs in that tab. |
| Named tab does not exist | `missing_target` |
| Named tab is still loading | `not_ready` |
| No name, exactly one ready tab | Runs in that tab. |
| No name, more than one ready tab | `ambiguous_target`, with the candidates (browserId, project, document, view). |
| No name, no ready tab | `not_ready` |

## Commands and completion levels

The catalog holds these commands. Every one runs in a tab, through the same functions the tab's buttons use.

| Group | Commands |
|---|---|
| Documents | `listDocuments`, `openDocument`, `readDocument`, `editDocument`, `resetDocument`, `history` |
| Configurations | `listConfigurations`, `createConfiguration`, `switchConfiguration` |
| Sections of the open document | `listSections`, `readSection`, `editSection` (own body only), `insertSection` (`position`: `after` or `firstChild`), `moveSection` (`direction`: `up` or `down`), `removeSection` |
| Design of the open prompt | `getDesign`, `setDesign` (`input`, `workflow`, `output`), `verifySample` (`sample`, `contract`), `listWorkflowPatterns`, `applyWorkflowPattern` (`patternId`) |
| Verification of the open prompt | `listChecks`, `runChecks`, `getFindings`, `proposeCheck` (`kind`: `rule` or `criterion`), `getProposalStatus` (`proposalId`) |
| Evaluations of the open project prompt | `listSuites`, `runSuite` (`suiteId`, `allowPaidRun: true`), `getEvaluationResults` (`evaluationId`), `compareVersions` (`suiteId`, `baselineTag`, optional `candidateTag`, `allowPaidRun: true`) |
| Live editor resources | `readEditorResource` (`resource`: `document`, `sections`, `findings`, or `events`) |

Section and design commands take `rootId` (and `variantSymbol` for a variant) of the open document and a
`sectionId` from `listSections`; design commands without `sectionId` act on the whole prompt. `setDesign` and
`applyWorkflowPattern` run the Design panel's Save checks and save function, then open the Design panel on the
changed scope; a design the validator rejects fails with `invalid_input` and changes nothing. `proposeCheck` never
saves: the proposal waits in Verify → Checks & criteria until the person accepts, edits or rejects it. No command
starts the paid AI review. Each section edit is one text change through the editor's save path: an undo point and one
commit, and the graph and the outline update in the tab. The gateway rejects an unknown action
(`unsupported_command`) and invalid parameters (`invalid_input`: a missing field, a wrong type, a value outside an
`enum`) before it routes anything to a tab. `ps capabilities` prints each command's parameter schema.

The editor owns the live draft and recent actions. A tab sends `editor.changed` with the names of updated
resources, and the gateway adds the authenticated tab ID. Controllers opt in with `editorEvents: true` in `hello`.
The update contains resource names only. `readEditorResource` fetches content through the normal target check.

MCP keeps subscriptions on the persistent stdio connection and forwards updates for subscribed URIs. The
request-local HTTP transport serves resource discovery and reads. [MCP resource subscriptions](https://ts.sdk.modelcontextprotocol.io/v2/servers/resources)

A command's result can mean different things. Phase 1 supports one completion level:

- **`applied`** — the tab's handler finished and the change is in the editor's working state (for edits:
  committed to the tab's history). This is the default.
- `committed` and `rendered` are reserved. A command that asks for them with `waitFor` fails with
  `unsupported_completion`.

Messages for one command:

```
controller → gateway  { type: "command", requestId, commandId, action, params, target?, waitFor?, timeoutMs? }
gateway → controller  { type: "command.accepted", requestId, commandId, target: { browserId } }
gateway → tab         { type: "command", commandId, action, params }
tab → gateway         { type: "command.result", commandId, ok, data | error, code? }
gateway → controller  { type: "command.result", requestId, commandId, state: "completed" | "failed",
                        completionLevel: "applied", target, data | error }
```

`commandId` names the logical operation; a second command with a `commandId` that is still running fails with
`duplicate_command`. `requestId` names one transport attempt.

**Failures that may have taken effect.** If the tab does not answer in time (`timeout`) or disconnects before
answering (`disconnected`), the error carries `outcome: "unknown"`: the command may have run. Read the document
before you retry a change. Every other failure carries `outcome: "none"`.

**Revision scopes** (a document or project revision a command can be conditioned on) are Phase 2. Phase 1
commands are not conditional.

## Errors and exit codes

Error codes are stable and never renamed: `invalid_input`, `unsupported_version`, `unsupported_command`,
`unsupported_completion`, `unauthorized`, `forbidden`, `ambiguous_target`, `missing_target`, `not_ready`,
`duplicate_command`, `too_many_pending`, `payload_too_large`, `timeout`, `disconnected`, `command_failed`,
`internal`. A tab's own failure (for example "Open the document first") is `command_failed` with the tab's
message. A tab may report three more specific codes for its own failures: `invalid_input` (for example a section
tag with spaces), `missing_target` (an unknown section id) and `not_ready` (the document is still loading). The
tab sends the code in `command.result` (`code`); the gateway relays only these codes and reads any other code as
`command_failed`, so a tab cannot report a transport failure such as `timeout`.

The CLI's exit codes: `0` ok · `1` command failed · `2` usage or invalid input · `3` cannot connect (no
Studio, bad token, no common version) · `4` no tab, unknown tab or ambiguous tab · `5` timeout or disconnect
while a command ran.

## Limits

| Limit | Value | When exceeded |
|---|---|---|
| Frame size | 2 MiB + 4 KiB | The gateway closes the connection with `1009`. The client library refuses a larger command locally with `payload_too_large` and sends nothing. |
| Commands in flight per controller | 32 | `too_many_pending` |
| `hello` deadline | 5 s | Close `4408` |
| Command timeout | default 30 s, at most 300 s | `timeout`, outcome `unknown` |
| Liveness | ping every 30 s | A socket that misses a pong is closed. |

## Deprecated HTTP and SSE transport

The previous transport (`POST /__control/command`, `GET /__control/events`, `POST /__control/response`) stays
for one release and is then removed.

- The CLI and the MCP server use WebSocket by default. `ps --transport http` still uses the old route.
- When any tab is connected over WebSocket, `POST /__control/command` routes through the gateway with the same
  target rules (an ambiguous target answers HTTP 409 with `errorCode` and `candidates`; it accepts an optional
  `browserId`). Otherwise it uses the SSE relay.
- Its responses carry `Deprecation: true` and a `Link` to this page.
- An editor tab falls back to SSE only when the browser has no WebSocket or its first WebSocket connection
  fails (for example against an older server). After one successful connection it reconnects with backoff.

## Status of the specification items

"Verified end to end" means a test drives real processes or a real browser through the real entry points
(the CLI process, the MCP server, a Playwright tab). "Isolated tests" means real sockets against the real
gateway with a scripted tab, or unit tests. Requirement summaries are Prompt Studio's reading of the spec.

### Acceptance tests

| Item | Status | Where |
|---|---|---|
| AT-01 handshake, capabilities, incompatible version fails before execution | Isolated tests | `server/control-ws/gateway.test.ts` |
| AT-03 two tabs: untargeted → `ambiguous_target` with candidates; targeted → only that tab | Isolated tests; CLI process in the outcome test | `gateway.test.ts`, `remote-control.outcome.test.ts` |
| AT-04 no tab → `not_ready`; tab closes mid-command → `disconnected`, outcome `unknown` | Isolated tests | `gateway.test.ts` |
| AT-15 result from the wrong tab ignored; bad token → `4401`; foreign Origin → 403 | Isolated tests | `gateway.test.ts` |
| AT-19 real CLI: JSON output parses, ambiguous → exit 4, no Studio → exit 3, stderr apart from stdout | Verified end to end (CLI process, real gateway) | `server/control-ws/remote-control.outcome.test.ts` |
| AT-20 oversized frame rejected; pending limit | Isolated tests | `gateway.test.ts` |
| CLI drives a real tab over WebSocket (docs, read, open, edit shown in the tab) | Verified end to end (Playwright) | `tests/e2e/control-channel.spec.ts` |
| Other AT items (revision scopes, progress events, subscriptions, `committed`/`rendered` levels, resumable results) | Not yet implemented | Phase 2 and later |

### Requirements

| Area | Status |
|---|---|
| One WebSocket endpoint, roles `browser` and `controller` | Verified end to end |
| Authentication in the first message, timing-safe token, `hello` deadline, Origin check on upgrade | Isolated tests |
| Version negotiation before any command | Isolated tests |
| Capability discovery (`welcome` catalog, `ps capabilities`) | Verified end to end (CLI process) |
| Target listing with tab state, `state.update` | Verified end to end (Playwright and CLI) |
| Stable `browserId` across reload when the old socket is gone | Isolated tests (gateway rule; tab storage in unit tests) |
| Validation before routing; target selection rules | Isolated tests |
| `command.accepted` / `command.result`, `applied` completion level | Verified end to end |
| Result accepted only from the routed tab (RC-37) | Isolated tests |
| Timeout and disconnect with `outcome: unknown`; duplicate `commandId` refused | Isolated tests |
| Stable error codes and CLI exit codes; JSON on stdout, diagnostics on stderr | Verified end to end (CLI process) |
| Frame size limit, pending limit, liveness pings | Isolated tests (pings: not tested) |
| No tokens or params in logs | Isolated tests |
| Deprecated HTTP route through the gateway, `Deprecation` header | Isolated tests |
| Revision scopes and conditional commands | Not yet implemented (Phase 2) |
| `command.progress`, `state.event`, `subscribe`, `command.status` (query a result after reconnect) | Not yet implemented |
| `committed` and `rendered` completion levels | Not yet implemented |
| Gateway-executed commands (no tab needed) | Not yet implemented |
| Idempotent replay of a finished `commandId` | Not yet implemented (only in-flight duplicates are refused) |
