import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSpec } from '@/lib/ai/schema/expand';
import { handleMessage } from '@/lib/mcp/server';
import { callTool, TOOLS } from '@/lib/mcp/tools';
import { openLibrary, type Library } from '@/lib/store/library';
import { sampleObservation, sampleWebTranslation } from './fixtures';

let dir: string;
let lib: Library;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'inspi-mcp-'));
  lib = openLibrary(dir);
});

afterEach(() => {
  lib.close();
  rmSync(dir, { recursive: true, force: true });
});

function add(name: string, tags: string[]) {
  const imageId = `img${Math.random().toString(36).slice(2, 8)}`;
  const entry = lib.createEntry({ mode: 'web', compress: false, images: [{ id: imageId, width: 10, height: 10, bytes: 1, placeholder: '#000', sha256: 'x' }] });
  mkdirSync(join(dir, 'media', entry.id), { recursive: true });
  writeFileSync(join(dir, 'media', entry.id, `${imageId}.webp`), Buffer.from('RIFFfakewebp'));
  const identity = { name, category: 'Landing Page' as const, tags };
  const spec = buildSpec({ mode: 'web', observation: sampleObservation('web'), translation: sampleWebTranslation(), identity });
  return lib.applyAnalysis(entry.id, { identity, version: { lens: 'balanced', note: `${name} note`, spec, provider: 'Groq', model: 'm', tokensIn: 1, tokensOut: 1, durationMs: 1 } });
}

const ctx = () => ({ lib, mediaRoot: join(dir, 'media'), baseUrl: 'http://localhost:3000' });
const text = (result: Awaited<ReturnType<typeof callTool>>) => result.content.map((c) => ('text' in c ? c.text : '')).join('\n');

describe('INSPi MCP tools', () => {
  it('are all described, with the read-only and open-world hints the contract sets', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      'analyze_image',
      'generate_image',
      'get_prompt',
      'get_reference',
      'get_reference_image',
      'library_overview',
      'list_models',
      'search_references',
      'set_model',
      'write_prompt',
    ]);
    const hints: Record<string, { readOnlyHint: boolean; openWorldHint: boolean }> = {
      analyze_image: { readOnlyHint: false, openWorldHint: true },
      generate_image: { readOnlyHint: false, openWorldHint: true },
      get_prompt: { readOnlyHint: true, openWorldHint: false },
      get_reference: { readOnlyHint: true, openWorldHint: false },
      get_reference_image: { readOnlyHint: true, openWorldHint: false },
      library_overview: { readOnlyHint: true, openWorldHint: false },
      list_models: { readOnlyHint: true, openWorldHint: true },
      search_references: { readOnlyHint: true, openWorldHint: false },
      set_model: { readOnlyHint: false, openWorldHint: false },
      write_prompt: { readOnlyHint: false, openWorldHint: true },
    };
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.annotations).toMatchObject(hints[tool.name]);
    }
  });

  it('finds references by words and tags', async () => {
    add('Glass Dusk', ['frosted glass']);
    add('Pink Coin Hero', ['hot pink']);
    const found = text(await callTool(ctx(), 'search_references', { query: 'pink' }));
    expect(found).toContain('Pink Coin Hero');
    expect(found).not.toContain('Glass Dusk');
    expect(text(await callTool(ctx(), 'search_references', { tag: 'frosted glass' }))).toContain('glass-dusk');
  });

  it('returns the copy-ready prompt by name, slug or id, or only its JSON', async () => {
    const entry = add('Glass Dusk', ['frosted glass']);
    for (const reference of ['Glass Dusk', 'glass dusk', 'glass-dusk', entry.id]) {
      const result = await callTool(ctx(), 'get_prompt', { reference });
      expect(result.isError).toBeFalsy();
      expect(text(result)).toContain('"inspi": "web/2"');
      expect(text(result)).toMatch(/^(Use the reference|Generate)/);
    }
    const json = text(await callTool(ctx(), 'get_prompt', { reference: 'Glass Dusk', format: 'json' }));
    expect(JSON.parse(json).name).toBe('Glass Dusk');
  });

  it('says clearly when a reference is missing or ambiguous', async () => {
    add('Pink Coin Hero', ['hot pink']);
    add('Pink Neon Sign', ['hot pink']);
    const missing = await callTool(ctx(), 'get_prompt', { reference: 'Nothing Like It' });
    expect(missing.isError).toBe(true);
    const ambiguous = await callTool(ctx(), 'get_prompt', { reference: 'pink' });
    expect(ambiguous.isError).toBe(true);
    expect(text(ambiguous)).toContain('Pink Coin Hero');
    expect(text(ambiguous)).toContain('Pink Neon Sign');
  });

  it('describes a reference with its page address, and hands over its image', async () => {
    add('Glass Dusk', ['frosted glass']);
    expect(text(await callTool(ctx(), 'get_reference', { reference: 'Glass Dusk' }))).toContain('http://localhost:3000/e/glass-dusk');
    const image = await callTool(ctx(), 'get_reference_image', { reference: 'Glass Dusk' });
    expect(image.content[0]).toMatchObject({ type: 'image', mimeType: 'image/webp' });
  });
});

describe('INSPi MCP protocol', () => {
  it('answers initialize, lists tools and runs a call', async () => {
    add('Glass Dusk', ['frosted glass']);
    const init = await handleMessage(ctx(), { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect(init).toMatchObject({ id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'inspi' } } });
    expect(await handleMessage(ctx(), { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    const list = (await handleMessage(ctx(), { jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: unknown[] } };
    expect(list.result.tools).toHaveLength(10);
    const call = (await handleMessage(ctx(), { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_prompt', arguments: { reference: 'Glass Dusk', format: 'json' } } })) as { result: { content: { text: string }[] } };
    expect(JSON.parse(call.result.content[0].text).name).toBe('Glass Dusk');
    expect(await handleMessage(ctx(), { jsonrpc: '2.0', id: 4, method: 'nope' })).toMatchObject({ id: 4, error: { code: -32601 } });
  });
});
