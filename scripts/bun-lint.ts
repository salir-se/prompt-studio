#!/usr/bin/env bun

/**
 * Runs `bun lint` with the Bun build that ships the linter.
 *
 * The linter is configured in `bunfig.toml` `[lint]`. Bun 1.4.4 hides the command, so this wrapper runs the
 * published canary through `bunx` (cached after the first download). When a stable Bun ships `bun lint`, replace
 * `bun scripts/bun-lint.ts` with `bun lint --no-script` and delete this file. `--no-script` matters: the
 * `lint` script in package.json would otherwise shadow the built-in command.
 *
 * Arguments pass through unchanged: `--fix`, `--staged`, paths.
 */

import { spawnSync } from 'node:child_process';

export const BUN_LINT_VERSION = '1.4.4-canary.20261027.1';

export function bunLintCommand(args: readonly string[] = []): string[] {
  return ['bunx', `bun@${BUN_LINT_VERSION}`, 'lint', '--no-script', ...args];
}

if (import.meta.main) {
  const [command, ...args] = bunLintCommand(process.argv.slice(2));
  const result = spawnSync(command as string, args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
