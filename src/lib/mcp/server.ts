import { createInterface } from 'node:readline';
import { callTool, TOOLS, type ToolContext } from './tools';

/**
 * A minimal MCP server over stdio: newline-delimited JSON-RPC 2.0 with the three methods a tools-only
 * server needs (initialize, tools/list, tools/call). Written out rather than pulled from the SDK,
 * which would bring a web server's worth of dependencies for this.
 */

const LATEST = '2025-06-18';
const SUPPORTED = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

interface Request {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type Response = { jsonrpc: '2.0'; id: string | number | null } & ({ result: unknown } | { error: { code: number; message: string } });

/** Answers one message; null for notifications, which get no reply. */
export async function handleMessage(ctx: ToolContext, message: Request): Promise<Response | null> {
  const id = message.id ?? null;
  const reply = (result: unknown): Response => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, text: string): Response => ({ jsonrpc: '2.0', id, error: { code, message: text } });
  if (message.id === undefined) return null;

  switch (message.method) {
    case 'initialize': {
      const asked = String(message.params?.protocolVersion ?? '');
      return reply({
        protocolVersion: SUPPORTED.has(asked) ? asked : LATEST,
        capabilities: { tools: {} },
        serverInfo: { name: 'inspi', title: 'INSPi', version: '1.0.0' },
        instructions:
          'INSPi is a personal library of visual references. Each has a copy-ready prompt that describes its design system. Find references with search_references or library_overview, then fetch the prompt with get_prompt and, if useful, the image with get_reference_image.',
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = String(message.params?.name ?? '');
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        return reply(await callTool(ctx, name, args));
      } catch (error) {
        return reply({ content: [{ type: 'text', text: error instanceof Error ? error.message : 'The tool failed.' }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${message.method}`);
  }
}

/** Reads requests from stdin and writes replies to stdout until stdin closes. Logs go to stderr. */
export function runStdio(ctx: ToolContext): void {
  const lines = createInterface({ input: process.stdin });
  lines.on('line', async (line) => {
    if (!line.trim()) return;
    let message: Request;
    try {
      message = JSON.parse(line) as Request;
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      return;
    }
    const response = await handleMessage(ctx, message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
  lines.on('close', () => {
    ctx.lib.close();
    process.exit(0);
  });
}
