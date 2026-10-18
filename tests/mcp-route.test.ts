import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/mcp/route';
import { TOOLS } from '@/lib/mcp/tools';

describe('GET /api/mcp', () => {
  it('names the tools a coding agent gets, beside the command that connects it', async () => {
    const body = (await (await GET()).json()) as { claude: string; tools: string[] };
    expect(body.claude.startsWith('claude mcp add --scope user inspi -- ')).toBe(true);
    expect(body.tools).toEqual(TOOLS.map((t) => t.name));
    expect(body.tools).toContain('search_references');
  });
});
