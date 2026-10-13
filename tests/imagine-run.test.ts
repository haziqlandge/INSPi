import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runImagine, withAspect } from '@/lib/imagine/run';
import { ImagineError } from '@/lib/imagine/types';
import { openLibrary, type Library } from '@/lib/store/library';

let dir: string;
let lib: Library;
const previous = process.env.INSPI_DATA_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'inspi-imagine-'));
  process.env.INSPI_DATA_DIR = dir;
  lib = openLibrary(dir);
});

afterEach(() => {
  lib.close();
  process.env.INSPI_DATA_DIR = previous;
  rmSync(dir, { recursive: true, force: true });
});

const image = () => ({ id: `img${Math.random().toString(36).slice(2, 8)}`, width: 800, height: 1000, bytes: 1, placeholder: '#332211', sha256: 'x' });
const png = async () => ({
  bytes: await sharp({ create: { width: 4, height: 4, channels: 3, background: '#c33' } }).png().toBuffer(),
  contentType: 'image/png',
});

describe('withAspect', () => {
  const size = { width: 1024, height: 576 };
  it("puts the picked ratio first and over the spec's own aspect_ratio", () => {
    const out = withAspect('Make it. {"params": {"aspect_ratio": "4:3", "medium": "3D"}}', '16:9', size);
    expect(out.startsWith('Aspect ratio: 16:9 (1024×576 px)')).toBe(true);
    expect(out).toContain('"aspect_ratio": "16:9"');
    expect(out).not.toContain('4:3');
  });
  it('leaves the prompt alone when no readable aspect was picked', () => {
    expect(withAspect('a fox', undefined, size)).toBe('a fox');
    expect(withAspect('a fox', 'wide', size)).toBe('a fox');
  });
});

describe('runImagine', () => {
  it('sends the picked aspect over the one in the prompt, and keeps the prompt as written', async () => {
    const sent: string[] = [];
    const generate = async (_b: string, req: { prompt: string }) => (sent.push(req.prompt), png());
    const prompt = '{"params":{"aspect_ratio":"4:3"}}';
    const render = await runImagine({ backend: 'pollinations', model: 'flux', prompt, aspect: '16:9' }, { lib, generate });
    expect(sent[0]).toContain('"aspect_ratio":"16:9"');
    expect(sent[0]).not.toContain('4:3');
    expect(render.prompt).toBe(prompt);
    expect([render.width, render.height]).toEqual([1024, 576]);
  });

  it('saves the image as WebP beside the entry and lists it', async () => {
    const entry = lib.createEntry({ mode: 'image', compress: false, images: [image()] });
    const render = await runImagine(
      { backend: 'pollinations', model: 'flux', prompt: 'a red fox', aspect: '3:2', seed: 5, entryId: entry.id },
      { lib, generate: png },
    );
    expect(render.width).toBe(1024);
    expect(render.height).toBe(688);
    expect(render.seed).toBe(5);
    const file = join(dir, 'media', entry.id, render.url.split('/').pop()!);
    expect(existsSync(file)).toBe(true);
    expect((await sharp(readFileSync(file)).metadata()).format).toBe('webp');
    expect(lib.listRenders({ entryId: entry.id, limit: 5, offset: 0 }).map((r) => r.id)).toEqual([render.id]);
  });

  it('saves playground renders in the playground folder', async () => {
    const render = await runImagine({ backend: 'keyless-url', model: 'default', prompt: 'dunes' }, { lib, generate: png });
    expect(render.entryId).toBeNull();
    expect(existsSync(join(dir, 'media', '_playground', render.url.split('/').pop()!))).toBe(true);
  });

  it('throws and leaves nothing behind when the entry is deleted mid-flight', async () => {
    const entry = lib.createEntry({ mode: 'image', compress: false, images: [image()] });
    const generate = async () => {
      lib.softDelete(entry.id);
      return png();
    };
    await expect(
      runImagine({ backend: 'pollinations', model: 'flux', prompt: 'a red fox', entryId: entry.id }, { lib, generate }),
    ).rejects.toThrow('That entry was deleted.');
    expect(lib.listRenders({ limit: 5, offset: 0 })).toEqual([]);
    const folder = join(dir, 'media', entry.id);
    expect(existsSync(folder) ? readdirSync(folder).filter((f) => f.startsWith('render-')) : []).toEqual([]);
  });

  it('records every request for the Usage page, failures included', async () => {
    await runImagine({ backend: 'pollinations', model: 'flux', prompt: 'ok' }, { lib, generate: png });
    const failing = async () => {
      throw new ImagineError('no_pollen', 'Out of Pollen for now.', 402);
    };
    await expect(runImagine({ backend: 'pollinations', model: 'zimage', prompt: 'no' }, { lib, generate: failing })).rejects.toThrow(
      'Out of Pollen for now.',
    );
    const calls = lib.recentCalls(5);
    expect(calls.map((c) => [c.provider, c.model, c.step, c.ok, c.error ?? null])).toEqual([
      ['pollinations', 'zimage', 'imagine', false, 'no_pollen'],
      ['pollinations', 'flux', 'imagine', true, null],
    ]);
  });
});

describe('reference picture', () => {
  it("shows the model the entry's first picture when asked", async () => {
    const entry = lib.createEntry({ mode: 'image', compress: false, images: [image()] });
    const seen: (string | undefined)[] = [];
    const generate = async (_b: unknown, req: { image?: string }) => (seen.push(req.image), png());
    const reference = async (_l: Library, id: string) => `data:image/jpeg;base64,${id}`;
    await runImagine({ backend: 'pollinations', model: 'gpt-image-2', prompt: 'p', entryId: entry.id, reference: true }, { lib, generate, reference });
    await runImagine({ backend: 'pollinations', model: 'gpt-image-2', prompt: 'p', entryId: entry.id }, { lib, generate, reference });
    expect(seen).toEqual([`data:image/jpeg;base64,${entry.id}`, undefined]);
  });

  it('is only accepted with an entry, and never for the keyless route', async () => {
    const { readImagineBody } = await import('@/lib/imagine/run');
    expect(readImagineBody({ backend: 'pollinations', model: 'm', prompt: 'p', entryId: 'abc', reference: true })).toMatchObject({ reference: true });
    expect(readImagineBody({ backend: 'pollinations', model: 'm', prompt: 'p', reference: true })).toEqual({ error: 'A reference picture needs an entry.' });
    expect(readImagineBody({ backend: 'keyless-url', model: 'default', prompt: 'p', entryId: 'abc', reference: true })).toEqual({
      error: 'The keyless route cannot be shown a reference image.',
    });
  });
});

describe('readImagineBody', () => {
  it('accepts a well-formed request and trims it', async () => {
    const { readImagineBody } = await import('@/lib/imagine/run');
    expect(readImagineBody({ backend: 'pollinations', model: ' flux ', prompt: ' fox ', aspect: '3:2' })).toEqual({
      backend: 'pollinations',
      model: 'flux',
      prompt: 'fox',
      aspect: '3:2',
    });
  });

  it('ignores a seed: Visualize no longer has one (5 Oct 2026)', async () => {
    const { readImagineBody } = await import('@/lib/imagine/run');
    expect(readImagineBody({ backend: 'pollinations', model: 'flux', prompt: 'fox', seed: 3 })).toEqual({ backend: 'pollinations', model: 'flux', prompt: 'fox' });
    expect(readImagineBody({ backend: 'pollinations', model: 'flux', prompt: 'fox', seed: -4 })).toEqual({ backend: 'pollinations', model: 'flux', prompt: 'fox' });
  });

  it.each([
    [{ backend: 'midjourney', model: 'x', prompt: 'p' }, 'Unknown image backend.'],
    [{ backend: 'pollinations', model: 'has space', prompt: 'p' }, 'Pick a model.'],
    [{ backend: 'pollinations', model: 'flux', prompt: '   ' }, 'Write a prompt first.'],
    [{ backend: 'pollinations', model: 'flux', prompt: 'x'.repeat(32_001) }, 'The prompt is longer than 32,000 characters.'],
  ])('rejects %j', async (body, message) => {
    const { readImagineBody } = await import('@/lib/imagine/run');
    expect(readImagineBody(body)).toEqual({ error: message });
  });
});

describe('image settings', () => {
  it('defaults to Pollinations FLUX.1 Schnell and only keeps a known backend and a clean model id', async () => {
    const { readSettings, writeSettings } = await import('@/lib/settings');
    expect(readSettings(lib).imagine).toEqual({ backend: 'pollinations', model: 'black-forest-labs/flux.1-schnell', auto: 'strongest' });
    expect(writeSettings(lib, { imagine: { backend: 'pollinations-community', model: 'community/MarcosFRG/flux-1-schnell' } }).imagine).toEqual({
      backend: 'pollinations-community',
      model: 'community/MarcosFRG/flux-1-schnell',
      auto: false,
    });
    expect(writeSettings(lib, { imagine: { backend: 'nope', model: 'x y' } }).imagine.backend).toBe('pollinations-community');
    // Back to letting INSPi pick the strongest model that works.
    expect(writeSettings(lib, { imagine: { auto: true } }).imagine).toEqual({ backend: 'pollinations', model: 'black-forest-labs/flux.1-schnell', auto: 'strongest' });
  });
});

describe('image settings saved before Auto existed', () => {
  it('read as Auto, so the strongest model is used until the person picks one', async () => {
    const { readSettings } = await import('@/lib/settings');
    lib.setSetting('settings', { imagine: { backend: 'pollinations', model: 'black-forest-labs/flux.1-schnell' } });
    expect(readSettings(lib).imagine.auto).toBe('strongest');
    lib.setSetting('settings', { imagine: { backend: 'pollinations', model: 'openai/gpt-image-1.5', auto: true } });
    expect(readSettings(lib).imagine.auto).toBe('strongest');
    lib.setSetting('settings', { imagine: { backend: 'pollinations', model: 'openai/gpt-image-1.5', auto: false } });
    expect(readSettings(lib).imagine).toEqual({ backend: 'pollinations', model: 'openai/gpt-image-1.5', auto: false });
  });
});
