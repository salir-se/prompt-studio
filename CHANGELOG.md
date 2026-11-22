# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- MCP server (`prompt-studio-mcp`) in the npm package and the Docker image: AI agents such as Claude Code and
  Codex list, read and edit prompts in the open editor tab. Setup: `docs/mcp.md`.
- Remote control over WebSocket (`/__control/ws`, phase 1; `docs/remote-control.md`). The CLI and the MCP server
  now connect over WebSocket by default. With several editor tabs open, choose one: `ps targets` and
  `--target <browserId>`, or the MCP `list_targets` tool and the `browserId` argument on every tool. New
  `ps capabilities`, `--timeout` and `--transport ws|http` flags, stable error codes, and documented exit codes
  (`3` cannot connect, `4` no or ambiguous tab, `5` timeout).
- Getting-started tutorial (`demos/getting-started.demo.ts`) recorded with Argo, and README screenshots.
- Docker image `ghcr.io/salir-se/prompt-studio` for `linux/amd64` and `linux/arm64`, published with every release.

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

- The npm package `@salir-se/prompt-studio` is published publicly on npmjs.
- Run with tools uses a new provider-neutral tool loop (`packages/agent/src/tool-loop.ts`).

### Removed

- The built-in catalog of the original private build. The editor now works only on the project you open.
- The hosted LLM provider of the private build. Bring your own provider API key.
