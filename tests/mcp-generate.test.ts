import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { chatJson, ProviderId } from '@/lib/ai/client';
import { buildSpec } from '@/lib/ai/schema/expand';
import { composePrompt } from '@/lib/copy/compose';
import { callTool, type ToolContext } from '@/lib/mcp/tools';
import type { ImageModel, BackendId, ImagineRequest } from '@/lib/imagine/types';
import { ImagineError } from '@/lib/imagine/types';
import type { ModelListing } from '@/lib/ai/status';
import { readSettings } from '@/lib/settings';
import { openLibrary, type Library } from '@/lib/store/library';
import { sampleObservation, sampleWebTranslation } from './fixtures';

type Deps = NonNullable<ToolContext['deps']>;

let dir: string;
let lib: Library;
let mediaRoot: string;
let PNG_BYTES: Buffer;

beforeAll(async () => {
  PNG_BYTES = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#f00' } }).png().toBuffer();
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'inspi-mcp-gen-'));
  lib = openLibrary(dir);
  mediaRoot = join(dir, 'media');
});

afterEach(() => {
  lib.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Same helper as tests/mcp.test.ts: a saved entry with one image and one analysed version. */
function add(name: string, tags: string[]) {
  const imageId = `img${Math.random().toString(36).slice(2, 8)}`;
  const entry = lib.createEntry({ mode: 'web', compress: false, images: [{ id: imageId, width: 10, height: 10, bytes: 1, placeholder: '#000', sha256: 'x' }] });
  mkdirSync(join(dir, 'media', entry.id), { recursive: true });
  writeFileSync(join(dir, 'media', entry.id, `${imageId}.webp`), Buffer.from('RIFFfakewebp'));
  const identity = { name, category: 'Landing Page' as const, tags };
  const spec = buildSpec({ mode: 'web', observation: sampleObservation('web'), translation: sampleWebTranslation(), identity });
  return lib.applyAnalysis(entry.id, { identity, version: { lens: 'balanced', note: `${name} note`, spec, provider: 'Groq', model: 'm', tokensIn: 1, tokensOut: 1, durationMs: 1 } });
}

const text = (result: Awaited<ReturnType<typeof callTool>>) => result.content.map((c) => ('text' in c ? c.text : '')).join('\n');

/** A section of list_models output, from its heading line up to the other heading (or the end). */
function sectionOf(out: string, heading: 'IMAGE MODELS' | 'TEXT MODELS'): string {
  const lines = out.split('\n');
  const start = lines.findIndex((line) => line.includes(heading));
  if (start < 0) return '';
  const other = heading === 'IMAGE MODELS' ? 'TEXT MODELS' : 'IMAGE MODELS';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].includes(other)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

type FakeEnv = Record<string, string | undefined>;

const KEYS: FakeEnv = { POLLINATIONS_API_KEY: 'k', GROQ_API_KEY: 'g' };

const FLUX: ImageModel = { id: 'black-forest-labs/flux.1-schnell', label: 'Flux Schnell', acceptsImage: false, health: 'healthy', successRate: 95 };
const Z_IMAGE: ImageModel = { id: 'tongyi-mai/z-image-turbo', label: 'Z-Image Turbo', acceptsImage: false, health: 'healthy', successRate: null };
const GPT_IMAGE_2: ImageModel = { id: 'openai/gpt-image-2', label: 'GPT Image 2', acceptsImage: true, health: 'degraded', successRate: 72 };

const IMAGE_MODELS: Partial<Record<BackendId, ImageModel[]>> = { pollinations: [FLUX, Z_IMAGE, GPT_IMAGE_2] };
const IMAGE_IDS = [FLUX.id, Z_IMAGE.id, GPT_IMAGE_2.id];

const TEXT_LISTINGS: Partial<Record<ProviderId, ModelListing>> = {
  groq: {
    ok: true,
    models: [
      { id: 'qwen/qwen3.8-27b', vision: true, free: true },
      { id: 'openai/gpt-oss-120b', vision: false, free: true },
    ],
    message: '',
  },
  gemini: { ok: true, models: [{ id: 'gemini-only-model', vision: true, free: true }], message: '' },
};

const fakeDeps = (): Partial<Deps> => ({
  imageModels: async (backend) => IMAGE_MODELS[backend] ?? [],
  textModels: async (provider) => TEXT_LISTINGS[provider] ?? { ok: true, models: [], message: '' },
});

/** A context with the shared fakes, plus whatever a test adds; env defaults to a Pollinations and a Groq key. */
function ctxWith(extra: Partial<Deps> = {}, env: FakeEnv = KEYS): ToolContext {
  return {
    lib,
    mediaRoot,
    baseUrl: 'http://localhost:3000',
    deps: { env, ...fakeDeps(), ...extra },
  };
}

const okGenerate = () => vi.fn(async (_backend: BackendId, _req: ImagineRequest) => ({ bytes: PNG_BYTES, contentType: 'image/png' }));

describe('list_models', () => {
  it('has an image section and a text section, each with its models', async () => {
    const result = await callTool(ctxWith(), 'list_models', {});
    expect(result.isError).toBeFalsy();
    const out = text(result);
    const imageSection = sectionOf(out, 'IMAGE MODELS');
    const textSection = sectionOf(out, 'TEXT MODELS');
    expect(imageSection).toContain(GPT_IMAGE_2.id);
    expect(imageSection).toMatch(/healthy/i);
    expect(textSection).toContain('qwen/qwen3.8-27b');
    expect(textSection).toMatch(/vision/i);
    expect(textSection).not.toContain(GPT_IMAGE_2.id);
  });

  it('kind image has no text section, and kind text has no image section', async () => {
    const images = text(await callTool(ctxWith(), 'list_models', { kind: 'image' }));
    expect(images).toContain('IMAGE MODELS');
    expect(images).toContain(GPT_IMAGE_2.id);
    expect(images).not.toContain('TEXT MODELS');

    const texts = text(await callTool(ctxWith(), 'list_models', { kind: 'text' }));
    expect(texts).toContain('TEXT MODELS');
    expect(texts).toContain('qwen/qwen3.8-27b');
    expect(texts).not.toContain('IMAGE MODELS');
  });

  it('lists text models only for providers that have a key', async () => {
    const without = text(await callTool(ctxWith({}, { POLLINATIONS_API_KEY: 'k', GROQ_API_KEY: 'g' }), 'list_models', { kind: 'text' }));
    expect(without).toContain('qwen/qwen3.8-27b');
    expect(without).not.toContain('gemini-only-model');

    const withGemini = text(await callTool(ctxWith({}, { GROQ_API_KEY: 'g', GEMINI_API_KEY: 'x' }), 'list_models', { kind: 'text' }));
    expect(withGemini).toContain('gemini-only-model');
  });

  it('marks the model in use as current: what AutoPick picks until a model is chosen, then the chosen one', async () => {
    // Default settings are AutoPick "strongest": the pick is the strongest healthy model right now
    const before = text(await callTool(ctxWith(), 'list_models', {}));
    expect(before).toContain('AutoPick "strongest"');
    const lines = (out: string) => out.split(String.fromCharCode(10));
    expect(lines(before).find((line) => line.startsWith(`- ${Z_IMAGE.id}`))).toMatch(/current/i);
    expect(lines(before).find((line) => line.startsWith(`- ${FLUX.id}`)) ?? '').not.toMatch(/current/i);
    expect(lines(before).some((line) => /groq/i.test(line) && /current/i.test(line))).toBe(true);

    await callTool(ctxWith(), 'set_model', { kind: 'image', model: FLUX.id });
    const after = text(await callTool(ctxWith(), 'list_models', { kind: 'image' }));
    expect(lines(after).find((line) => line.startsWith(`- ${FLUX.id}`))).toMatch(/current/i);
    expect(lines(after).find((line) => line.startsWith(`- ${Z_IMAGE.id}`)) ?? '').not.toMatch(/current/i);
  });
});

describe('set_model', () => {
  it('saves an image model as the one Visualize uses', async () => {
    const result = await callTool(ctxWith(), 'set_model', { kind: 'image', model: GPT_IMAGE_2.id });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain(GPT_IMAGE_2.id);
    expect(readSettings(lib).imagine).toEqual({ backend: 'pollinations', model: GPT_IMAGE_2.id, auto: false });
  });

  it('refuses an image model that no backend lists, and keeps the saved one', async () => {
    expect((await callTool(ctxWith(), 'set_model', { kind: 'image', model: GPT_IMAGE_2.id })).isError).toBeFalsy();
    const result = await callTool(ctxWith(), 'set_model', { kind: 'image', model: 'nobody/no-such-model' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('nobody/no-such-model');
    expect(readSettings(lib).imagine.model).toBe(GPT_IMAGE_2.id);
  });

  it('switches image auto mode to cheapest, strongest or balanced, and refuses other values', async () => {
    for (const auto of ['cheapest', 'balanced', 'strongest'] as const) {
      const result = await callTool(ctxWith(), 'set_model', { kind: 'image', auto });
      expect(result.isError).toBeFalsy();
      expect(readSettings(lib).imagine.auto).toBe(auto);
    }
    const bad = await callTool(ctxWith(), 'set_model', { kind: 'image', auto: 'turbo' });
    expect(bad.isError).toBe(true);
    expect(readSettings(lib).imagine.auto).toBe('strongest');
  });

  it('saves a provider’s vision and text models, and makes that provider the one in use', async () => {
    const result = await callTool(ctxWith(), 'set_model', { kind: 'text', provider: 'groq', vision: 'v-model', text: 't-model', use: true });
    expect(result.isError).toBeFalsy();
    const settings = readSettings(lib);
    expect(settings.models.groq).toEqual({ vision: 'v-model', text: 't-model' });
    expect(settings.order[0]).toBe('groq');
  });

  it('refuses a provider whose key is missing, and an unknown provider', async () => {
    const env = { GROQ_API_KEY: 'g' };
    expect((await callTool(ctxWith({}, env), 'set_model', { kind: 'text', provider: 'groq', vision: 'v', text: 't', use: true })).isError).toBeFalsy();

    const noKey = await callTool(ctxWith({}, env), 'set_model', { kind: 'text', provider: 'gemini', vision: 'v', text: 't', use: true });
    expect(noKey.isError).toBe(true);
    const unknown = await callTool(ctxWith({}, env), 'set_model', { kind: 'text', provider: 'nopeai', vision: 'v', text: 't', use: true });
    expect(unknown.isError).toBe(true);
    expect(readSettings(lib).models.gemini).toBeUndefined();
  });

  it('needs a kind of image or text', async () => {
    expect((await callTool(ctxWith(), 'set_model', { kind: 'image', auto: 'balanced' })).isError).toBeFalsy();
    expect((await callTool(ctxWith(), 'set_model', { auto: 'balanced' })).isError).toBe(true);
    expect((await callTool(ctxWith(), 'set_model', { kind: 'video', model: 'x/y' })).isError).toBe(true);
  });
});

describe('generate_image', () => {
  it('makes the picture with the model named, returns it as WebP with a link to Visualize, and stores the render', async () => {
    const generate = okGenerate();
    const result = await callTool(ctxWith({ generate }), 'generate_image', { prompt: 'a glass dusk city', model: GPT_IMAGE_2.id });
    expect(result.isError).toBeFalsy();
    expect(generate).toHaveBeenCalledTimes(1);

    const [backend, req] = generate.mock.calls[0];
    expect(backend).toBe('pollinations');
    expect(req).toMatchObject({ model: GPT_IMAGE_2.id, width: 1024, height: 1024 });
    expect(req.prompt).toContain('a glass dusk city');

    const out = text(result);
    expect(out).toContain(GPT_IMAGE_2.id);
    expect(out).toContain('/visualize');

    const image = result.content.find((c) => c.type === 'image');
    expect(image).toMatchObject({ type: 'image', mimeType: 'image/webp' });
    const bytes = Buffer.from((image as { data: string }).data, 'base64');
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');

    const renders = lib.listRenders({ limit: 10, offset: 0 });
    expect(renders).toHaveLength(1);
    expect(renders[0]).toMatchObject({ model: GPT_IMAGE_2.id });
    expect(renders[0].prompt).toContain('a glass dusk city');
  });

  it('uses the image model chosen in settings when the call names none', async () => {
    expect((await callTool(ctxWith(), 'set_model', { kind: 'image', model: Z_IMAGE.id })).isError).toBeFalsy();
    const generate = okGenerate();
    await callTool(ctxWith({ generate }), 'generate_image', { prompt: 'a lamp' });
    expect(generate.mock.calls[0][1].model).toBe(Z_IMAGE.id);
  });

  it('an explicit model overrides the one saved in settings', async () => {
    expect((await callTool(ctxWith(), 'set_model', { kind: 'image', model: Z_IMAGE.id })).isError).toBeFalsy();
    const generate = okGenerate();
    await callTool(ctxWith({ generate }), 'generate_image', { prompt: 'a lamp', model: GPT_IMAGE_2.id });
    expect(generate.mock.calls[0][1].model).toBe(GPT_IMAGE_2.id);
  });

  it('with default settings, picks a model that the backend lists', async () => {
    const generate = okGenerate();
    const result = await callTool(ctxWith({ generate }), 'generate_image', { prompt: 'a lamp' });
    expect(result.isError).toBeFalsy();
    expect(IMAGE_IDS).toContain(generate.mock.calls[0][1].model);
  });

  it('sizes a 2:1 picture 1024 by 512', async () => {
    const generate = okGenerate();
    const result = await callTool(ctxWith({ generate }), 'generate_image', { prompt: 'a wide lake', model: FLUX.id, aspect: '2:1' });
    expect(result.isError).toBeFalsy();
    expect(generate.mock.calls[0][1]).toMatchObject({ width: 1024, height: 512 });
  });

  it('writes the original bytes to save_to, creating folders, and names the path in its reply', async () => {
    const target = join(dir, 'out', 'nested', 'pic.png');
    const generate = okGenerate();
    const result = await callTool(ctxWith({ generate }), 'generate_image', { prompt: 'a lamp', model: GPT_IMAGE_2.id, save_to: target });
    expect(result.isError).toBeFalsy();
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target).equals(PNG_BYTES)).toBe(true);
    expect(text(result)).toContain(target);
  });

  it('reports Pollen running out as an error and stores no render for it', async () => {
    const first = await callTool(ctxWith({ generate: okGenerate() }), 'generate_image', { prompt: 'a lamp', model: GPT_IMAGE_2.id });
    expect(first.isError).toBeFalsy();

    const generate = vi.fn(async () => {
      throw new ImagineError('no_pollen', 'Out of Pollen for now.');
    });
    const result = await callTool(ctxWith({ generate }), 'generate_image', { prompt: 'a lamp', model: GPT_IMAGE_2.id });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Out of Pollen');
    expect(lib.listRenders({ limit: 10, offset: 0 })).toHaveLength(1);
  });

  it('needs a prompt', async () => {
    const generate = okGenerate();
    expect((await callTool(ctxWith({ generate }), 'generate_image', { prompt: 'a lamp', model: GPT_IMAGE_2.id })).isError).toBeFalsy();
    const result = await callTool(ctxWith({ generate }), 'generate_image', { prompt: '   ' });
    expect(result.isError).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('needs POLLINATIONS_API_KEY for the pollinations backend', async () => {
    const generate = okGenerate();
    expect((await callTool(ctxWith({ generate }), 'generate_image', { prompt: 'a lamp', model: GPT_IMAGE_2.id, backend: 'pollinations' })).isError).toBeFalsy();
    const result = await callTool(ctxWith({ generate }, { GROQ_API_KEY: 'g' }), 'generate_image', {
      prompt: 'a lamp',
      model: GPT_IMAGE_2.id,
      backend: 'pollinations',
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('POLLINATIONS_API_KEY');
  });
});

describe('write_prompt', () => {
  /** A fake chat that always answers with one prompt and one negative prompt; its requests are kept. */
  function fakeWriter() {
    const writer = vi.fn(async (_req: { system: string; user: string }) => ({
      data: { prompt: 'A polished prompt', negative: 'blurry' },
      usage: { input: 1, output: 1 },
      rate: {},
    }));
    return { writer, chat: writer as unknown as typeof chatJson };
  }

  it('returns the prompt and negative prompt the model writes, and sends the idea to it', async () => {
    const { writer, chat } = fakeWriter();
    const result = await callTool(ctxWith({ chat }), 'write_prompt', { idea: 'a neon fox in the rain' });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('A polished prompt');
    expect(text(result)).toContain('blurry');
    expect(writer.mock.calls[0][0].user).toContain('a neon fox in the rain');
  });

  it('gives the writer the named reference', async () => {
    add('Glass Dusk', ['frosted glass']);
    const { writer, chat } = fakeWriter();
    const result = await callTool(ctxWith({ chat }), 'write_prompt', { idea: 'a lighthouse', reference: 'Glass Dusk' });
    expect(result.isError).toBeFalsy();
    const sent = writer.mock.calls[0][0];
    expect(`${sent.system}\n${sent.user}`).toContain('Glass Dusk');
  });

  it('accepts the image, spritesheet and ui kinds', async () => {
    const { chat } = fakeWriter();
    for (const kind of ['image', 'spritesheet', 'ui'] as const) {
      const result = await callTool(ctxWith({ chat }), 'write_prompt', { idea: 'a coin', kind });
      expect(result.isError).toBeFalsy();
    }
  });

  it('says to add an API key when no provider has one', async () => {
    const { chat } = fakeWriter();
    expect((await callTool(ctxWith({ chat }, { GROQ_API_KEY: 'g' }), 'write_prompt', { idea: 'a coin' })).isError).toBeFalsy();

    const result = await callTool(ctxWith({ chat }, {}), 'write_prompt', { idea: 'a coin' });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/api key/i);
  });

  it('needs an idea', async () => {
    const { chat } = fakeWriter();
    expect((await callTool(ctxWith({ chat }), 'write_prompt', { idea: 'a coin' })).isError).toBeFalsy();
    const result = await callTool(ctxWith({ chat }), 'write_prompt', { idea: '   ' });
    expect(result.isError).toBe(true);
  });
});

describe('analyze_image', () => {
  /** Stands in for the real analysis: saves a web spec on the entry it is given, as the add() helper does. */
  function fakeAnalyze() {
    return vi.fn(async (library: Library, entryId: string) => {
      const identity = { name: 'Dusk Lamp', category: 'Landing Page' as const, tags: ['dusk'] };
      const spec = buildSpec({ mode: 'web', observation: sampleObservation('web'), translation: sampleWebTranslation(), identity });
      library.applyAnalysis(entryId, {
        identity,
        version: { lens: 'balanced', note: 'Dusk note', spec, provider: 'Groq', model: 'm', tokensIn: 1, tokensOut: 1, durationMs: 1 },
      });
    });
  }

  it('adds a local image as a reference, analyses it, and replies with its prompt and page link', async () => {
    const source = join(dir, 'inbox', 'dusk.png');
    mkdirSync(join(dir, 'inbox'), { recursive: true });
    writeFileSync(source, PNG_BYTES);
    const analyze = fakeAnalyze();

    const result = await callTool(ctxWith({ analyze }), 'analyze_image', { source, mode: 'web' });
    expect(result.isError).toBeFalsy();

    const entries = lib.listEntries({ limit: 50 }).items;
    expect(entries).toHaveLength(1);
    expect(entries[0].imageCount).toBe(1);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0][1]).toBe(entries[0].id);

    const detail = lib.getEntry(entries[0].id)!;
    const out = text(result);
    expect(out).toContain('"inspi": "web/2"');
    expect(out).toContain(composePrompt(detail.versions[0].spec));
    expect(out).toContain(`http://localhost:3000/e/${entries[0].slug}`);
  });

  it('refuses a missing file or a file that is not an image, and adds nothing for them', async () => {
    const source = join(dir, 'inbox', 'dusk.png');
    mkdirSync(join(dir, 'inbox'), { recursive: true });
    writeFileSync(source, PNG_BYTES);
    const analyze = fakeAnalyze();
    expect((await callTool(ctxWith({ analyze }), 'analyze_image', { source })).isError).toBeFalsy();

    const missing = await callTool(ctxWith({ analyze }), 'analyze_image', { source: join(dir, 'nope.png') });
    expect(missing.isError).toBe(true);

    const notes = join(dir, 'inbox', 'notes.txt');
    writeFileSync(notes, 'just some words, not a picture');
    const notImage = await callTool(ctxWith({ analyze }), 'analyze_image', { source: notes });
    expect(notImage.isError).toBe(true);

    expect(lib.listEntries({ limit: 50 }).total).toBe(1);
    expect(analyze).toHaveBeenCalledTimes(1);
  });
});
