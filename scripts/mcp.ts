/**
 * INSPi as an MCP server, so coding agents can search the library, pull prompts, list and switch
 * image and text models, write prompts, generate images and turn a picture into a prompt.
 * Runs over stdio; the web app does not need to be running. Keys are read from .env.
 *
 *   claude mcp add inspi -- node <INSPi>/node_modules/tsx/dist/cli.mjs <INSPi>/scripts/mcp.ts
 *
 * Settings > Coding agents shows the exact command for this folder.
 */
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(process.argv[1]), '..');
process.env.INSPI_DATA_DIR ||= join(root, 'data');
// Next.js reads .env for the app; this process is not Next.js, so it reads it here (values already set win).
try {
  process.loadEnvFile(join(root, '.env'));
} catch {
  // No .env: the keys may be in the environment already
}

async function main() {
  // Imported after the data folder is settled, since the store reads it on first use.
  const { openLibrary } = await import('../src/lib/store/library');
  const { mediaRoot } = await import('../src/lib/paths');
  const { runStdio } = await import('../src/lib/mcp/server');
  const lib = openLibrary(process.env.INSPI_DATA_DIR!);
  runStdio({ lib, mediaRoot: mediaRoot(), baseUrl: process.env.INSPI_URL || 'http://localhost:3000' });
}

void main();
