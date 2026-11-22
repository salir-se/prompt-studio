#!/usr/bin/env node
/**
 * Launcher for the Prompt Studio server inside the `@salir-se/prompt-studio` npm package
 * (ADR-204 amendment 2026-09-15). Checked in as `.mjs` and copied verbatim to
 * `bin/prompt-studio.js` by scripts/build-npm-package.ts — it imports the bundled
 * `../server/main.js`, so it only runs inside the assembled package, never from this repo.
 *
 * Posture: identical to the container image (read-only bridge, per-boot token, Origin
 * validation) with two npm-appropriate default changes — the repo root defaults to the CURRENT
 * DIRECTORY (the container's `/repo` is a Docker mount point) and the bind host defaults to
 * `127.0.0.1` (structural loopback; the container needs `0.0.0.0` inside its network namespace
 * and sets it via its own ENV). Every `STUDIO_*` variable the operator sets explicitly wins
 * over these defaults — the layering lives in server/main.ts (`runStandaloneServer`).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStandaloneServer } from '../server/main.js';

const USAGE = `Usage: prompt-studio [--repo <dir>] [--port <n>] [--host <addr>] [--manifest <file>]

Serves the Prompt Studio editor for the repository checkout you run it from
(bridge roots: packages/prompts, packages/skills/skills, docs/prompts — or the
manifest you point --manifest at). Read-only: the studio never writes to it.

  --repo <dir>       Repository root to read (default: current directory)
  --port <n>         Port to listen on (default: 5273; env STUDIO_PORT)
  --host <addr>      Bind address (default: 127.0.0.1; env STUDIO_HOST)
  --manifest <file>  Studio manifest override (env STUDIO_MANIFEST_PATH)

Environment: STUDIO_REPO_ROOT, STUDIO_PORT, STUDIO_HOST, STUDIO_STATIC_DIR,
STUDIO_ALLOWED_ORIGINS, STUDIO_MANIFEST_PATH, ZAI_API_KEY (optional /verify
review), STUDIO_VERIFY_BUDGET, STUDIO_CONTROL_TOKEN. Explicit environment
always wins over the flags' defaults above.

Once it is up: npx @salir-se/prompt-studio-cli open`;

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      return next;
    };
    switch (arg) {
      case '--repo':
        flags.repo = value();
        break;
      case '--port':
        flags.port = value();
        break;
      case '--host':
        flags.host = value();
        break;
      case '--manifest':
        flags.manifest = value();
        break;
      case '--help':
      case '-h':
        flags.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return flags;
}

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let flags;
try {
  flags = parseFlags(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(USAGE);
  process.exit(2);
}
if (flags.help) {
  console.log(USAGE);
  process.exit(0);
}

// The allowed-origins default must track the port the server will actually bind — the browser
// sends `Origin: http://127.0.0.1:<port>` on every bridge request, and a stale default would
// 403 the studio's own fetches. Falls back to 5273 when the override is malformed; the config
// schema still rejects that malformed port at boot.
const rawPort = flags.port ?? process.env.STUDIO_PORT ?? '5273';
const portNumber = Number.parseInt(rawPort, 10);
const originPort = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535 ? portNumber : 5273;
const repoRoot = flags.repo ?? process.cwd();

console.log('Salir Prompt Studio (npm package — private; ADR-204)');
console.log(`  repo root : ${repoRoot}`);
console.log(`  bind      : ${flags.host ?? process.env.STUDIO_HOST ?? '127.0.0.1'}:${rawPort}`);

try {
  await runStandaloneServer(process.env, {
    envDefaults: {
      STUDIO_REPO_ROOT: repoRoot,
      STUDIO_HOST: flags.host ?? '127.0.0.1',
      STUDIO_PORT: flags.port,
      STUDIO_ALLOWED_ORIGINS: `http://127.0.0.1:${originPort},http://localhost:${originPort}`,
    },
    defaultManifestPath: path.join(pkgRoot, 'studio-manifest', 'manifest.json'),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
