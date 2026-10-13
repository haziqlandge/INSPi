/**
 * INSPi as an MCP server, so coding agents can search the library and pull prompts.
 * Read-only. Runs over stdio; the web app does not need to be running.
 *
 *   claude mcp add inspi -- node <INSPi>/node_modules/tsx/dist/cli.mjs <INSPi>/scripts/mcp.ts
 *
 * Settings > Coding agents shows the exact command for this folder.
 */
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(process.argv[1]), '..');
process.env.INSPI_DATA_DIR ||= join(root, 'data');

async function main() {
  // Imported after the data folder is settled, since the store reads it on first use.
  const { openLibrary } = await import('../src/lib/store/library');
  const { mediaRoot } = await import('../src/lib/paths');
  const { runStdio } = await import('../src/lib/mcp/server');
  const lib = openLibrary(process.env.INSPI_DATA_DIR!);
  runStdio({ lib, mediaRoot: mediaRoot(), baseUrl: process.env.INSPI_URL || 'http://localhost:3000' });
}

void main();
