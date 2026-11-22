#!/usr/bin/env bun
/**
 * Launcher for the Prompt Studio control CLI inside the `@salir/prompt-studio` npm package
 * (ADR-204 amendment 2026-09-15). Checked in as `.mjs` and copied verbatim to
 * `bin/prompt-studio-cli.js` by scripts/build-npm-package.ts — it imports the bundled
 * `../cli/main.js`, so it only runs inside the assembled package, never from this repo.
 *
 * Talks to an ALREADY-RUNNING studio (started via `prompt-studio`, `docker run
 * ghcr.io/salir-se/prompt-studio`, or the dev server), authenticating with the per-boot token
 * it discovers exactly like the repo's `bun run ps` client: --token, PROMPT_STUDIO_CONTROL_TOKEN,
 * or the 0600 token file the server publishes under the OS temp directory.
 */

import { runCli } from '../cli/main.js';

runCli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
