# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Bun is the only supported runtime. The npm package `@salir/prompt-studio` now requires Bun 1.4.4 or newer
  (`engines.bun`), its launchers run under `bun`, and it is published with `bun publish`, which cannot produce npm
  provenance attestations, so new releases carry none. Run it with `bunx @salir/prompt-studio`.

### Added

- MCP agents can list saved suites, opt in to running tests or comparing Git tags, and read per-case results shared with Evaluations (#9).
- Section tools for agents (#6): the MCP tools `list_sections`, `read_section`, `edit_section`, `insert_section`,
  `move_section` and `remove_section`, the matching remote-control commands, and `ps sections`, `ps section`,
  `ps edit-section` and `ps call`. An agent changes one section at a time; every other section stays
  byte-identical, each change is one commit, and the graph updates in the open tab.
- Design tools for agents (#7): `get_design`, `set_design`, `verify_sample`, `list_workflow_patterns` and
  `apply_workflow_pattern`, the matching remote-control commands, and `ps design` and `ps patterns`. A change is
  checked like the Design panel's Save, saved as a new design version, and shown in the Design panel; an invalid
  design fails with `invalid_input` and the validator's messages.
- Verification tools for agents (#8): `list_checks`, `run_checks`, `get_findings`, `propose_check` and
  `get_proposal_status`, the matching remote-control commands, and `ps checks` and `ps findings`. An agent
  proposes a check; it shows as **Proposed** in Verify → Checks & criteria, and only the person accepts, edits or
  rejects it. Findings report whether they are current or stale. AI review stays a person's action.
- A tab can report `invalid_input`, `missing_target` or `not_ready` for its own command failures; the gateway
  relays these codes instead of `command_failed`.
- MCP server (`prompt-studio-mcp`) in the npm package and the Docker image: AI agents such as Claude Code and
  Codex list, read and edit prompts in the open editor tab. Setup: `docs/mcp.md`.
- Remote control over WebSocket (`/__control/ws`, phase 1; `docs/remote-control.md`). The CLI and the MCP server
  now connect over WebSocket by default. With several editor tabs open, choose one: `ps targets` and
  `--target <browserId>`, or the MCP `list_targets` tool and the `browserId` argument on every tool. New
  `ps capabilities`, `--timeout` and `--transport ws|http` flags, stable error codes, and documented exit codes
  (`3` cannot connect, `4` no or ambiguous tab, `5` timeout).
- Getting-started tutorial (`demos/getting-started.demo.ts`) recorded with Argo, and README screenshots.
- Course "Prompt Studio: zero to hero": a written guide (`docs/guides/zero-to-hero.md`), the finished example
  project `examples/order-status` with its empty starting point, and scripts for six episodes (`demos/course`).
- Docker image `ghcr.io/salir-se/prompt-studio` for `linux/amd64` and `linux/arm64`, published with every release.
- The Docker image is also published to Docker Hub as `salirse/prompt-studio` when the release has Docker Hub
  credentials.

### Fixed

- Graph finding badges now display a space between the count and its label (#20).
- History kept only some commits when edits arrived faster than a commit finished (for example an agent's
  back-to-back edits): commits on both history providers now run one after another.
- The status bar recognizes variables declared in the open prompt's Design (#21).

### Deprecated

- The HTTP and server-sent-events control transport (`POST /__control/command`, `GET /__control/events`,
  `POST /__control/response`). It stays for one release; responses carry a `Deprecation` header. Use
  `ps --transport http` only with an older Studio.

### Security

- The installed app and the standalone server now listen on `127.0.0.1` by default. They previously bound
  `0.0.0.0`, which let other computers on the same network open the editor and read its per-launch token.

## [1.2.0] - First public release

### Added

- Public, Apache-2.0 licensed source release.
- `examples/starter`, a neutral example prompt project.
- Linux x64 binary alongside the macOS and Windows binaries.
- `prompt-studio update` reads `latest.json` from GitHub Releases and verifies the SHA-256 of every download.

### Changed

- The npm package `@salir/prompt-studio` is published publicly on npmjs.
- Run with tools uses a new provider-neutral tool loop (`packages/agent/src/tool-loop.ts`).

### Removed

- The built-in catalog of the original private build. The editor now works only on the project you open.
- The hosted LLM provider of the private build. Bring your own provider API key.
