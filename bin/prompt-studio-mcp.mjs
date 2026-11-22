#!/usr/bin/env bun
/**
 * Launcher for the Prompt Studio MCP server inside the `@salir/prompt-studio` npm package. Copied to
 * `bin/prompt-studio-mcp.js` by scripts/build-npm-package.ts; it imports the bundled `../mcp/main.js`.
 *
 * The server drives the editor tab you have open, through the same control channel as `prompt-studio-cli`.
 * Default transport is Streamable HTTP on 127.0.0.1:5274 (`/mcp`, bearer = the control token); pass
 * `--stdio` to run it as an MCP client subprocess instead.
 */
import { runMcpServer } from '../mcp/main.js';

try {
  await runMcpServer();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
