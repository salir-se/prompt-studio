# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- MCP server (`prompt-studio-mcp`) in the npm package and the Docker image: AI agents such as Claude Code and
  Codex list, read and edit prompts in the open editor tab. Setup: `docs/mcp.md`.

### Added

- Docker image `ghcr.io/salir-se/prompt-studio` for `linux/amd64` and `linux/arm64`, published with every release.

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
