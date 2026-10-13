import { join } from 'node:path';
import { ok } from '@/lib/http';
import { TOOLS } from '@/lib/mcp/tools';

const slashes = (path: string) => path.split('\\').join('/');

/** How to connect a coding agent to INSPi's MCP server (scripts/mcp.ts) from this folder. */
export async function GET() {
  const root = process.cwd();
  const node = slashes(process.execPath);
  const args = [slashes(join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')), slashes(join(root, 'scripts', 'mcp.ts'))];
  const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  return ok({
    claude: `claude mcp add --scope user inspi -- ${quote(node)} ${args.map(quote).join(' ')}`,
    json: JSON.stringify({ mcpServers: { inspi: { command: node, args } } }, null, 2),
    // What a connected agent can do, for the header's MCP popover
    tools: TOOLS.map((tool) => tool.name),
  });
}
