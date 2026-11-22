# Development

[Back to README](../README.md)

## Requirements

- [Bun](https://bun.sh) 1.4.4 or newer (runtime, package manager, linter, formatter, and type checker).

```bash
bun install
bun run dev          # Vite dev server on http://127.0.0.1:5273, editing examples/starter
STUDIO_REPO_ROOT=/path/to/prompts bun run dev   # edit another project
```

The dev server binds to `127.0.0.1` only. That is a security boundary: the server reads and writes project
files for whoever can reach it. `src/undeployable.test.ts` fails if the binding is widened.

## Repository layout

| Path | What it holds |
|---|---|
| `src/` | The React 19 editor (Vite, Tailwind CSS 4, shadcn/ui primitives). |
| `server/` | The local HTTP server: static files, file bridge, Git projects, runs, evaluations, MCP, GitHub publishing. |
| `cli/` | The control-channel CLI (`bun run ps`). |
| `packages/mcp-server` | The MCP server (`bun run mcp`) that lets AI agents drive the open editor. |
| `src/release/` | The single-file binary entry point and the `update` command. |
| `packages/prompts` | Prompt engine: prompt trees, designs, placeholders, verification profiles, blueprint serialization. |
| `packages/agent` | LLM provider adapters, the one-shot call, the tool-calling loop, and the MCP HTTP client. |
| `packages/prompt-graph-ui` | The graph canvas and prompt text components. |
| `packages/ui` | Shared UI primitives. |
| `packages/help-system`, `markdown`, `markdown-editor` | In-app help, Markdown rendering, and the Markdown editor. |
| `packages/observability`, `types` | Structured logging and shared type shapes. |
| `examples/starter` | A neutral example prompt project. |
| `tests/e2e` | Playwright journeys against the real dev server. |

## Checks

```bash
bun run lint         # bun lint + bun fmt --check
bun run typecheck    # bun check (tests and stories excluded; tests are type-checked when they run)
bun run test         # Vitest: the app, server, CLI, and scripts
bun run test:packages
bun run test:e2e     # Playwright (run `bunx playwright install chromium` once)
bun run build        # production SPA into dist/
bun run check:public-content   # refuses private content markers in tracked files
```

Tests follow a Given / When / Then comment structure. A feature has one *outcome test* that drives the real
entry point (a route, the CLI, the binary) and asserts the effect the user asked for; tests that only assert a
skip or a fallback do not count as that test.

## Releases

1. Update `CHANGELOG.md` and the version in `package.json`.
2. Push a tag `vX.Y.Z`. The `release` workflow runs the checks, compiles the four binaries, writes
   `latest.json` with SHA-256 checksums, creates the GitHub Release, pushes the multi-arch Docker image to
   `ghcr.io/salir-se/prompt-studio` (`X.Y.Z` and `latest`), and publishes the npm package with `bun publish` (when
   the `NPM_TOKEN` secret is set; `bun publish` cannot produce npm provenance, so releases carry none).

Build and try the image locally:

```bash
docker build -t prompt-studio:local .
docker run --rm -p 127.0.0.1:5273:5273 -v "$PWD/examples/starter":/repo prompt-studio:local
```

## Recording tutorials

Tutorial videos are [Argo](https://www.npmjs.com/package/@argo-video/cli) Playwright scripts in `demos/`
(`<name>.demo.ts` + `<name>.scenes.json` with the narration). The getting-started tutorial drives the real MCP
server and a deterministic local test model, so every take is the same.

```bash
bun run build
bun run demo:take -- getting-started                      # local Kokoro voice, free
ARGO_TTS=elevenlabs bun run demo:take -- getting-started  # publish render, needs ELEVENLABS_API_KEY
DEMO_SCREENSHOTS=docs/images bun run demo:take -- getting-started  # also refresh README screenshots
```

`demo:take` starts a fresh server with an empty profile, records, and stops it. Output goes to
`.output/argo-videos/getting-started/`.
