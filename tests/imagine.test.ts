import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import raw from './fixtures/pollinations-image-models.json';
import { splitImageModels } from '@/lib/imagine/catalog';
import { generateImage, imageUrl, MAX_PROMPT_CHARS, MAX_URL_PROMPT_CHARS } from '@/lib/imagine/backends';
import { sizeFor } from '@/lib/imagine/size';
import { ImagineError } from '@/lib/imagine/types';

const env = { POLLINATIONS_API_KEY: 'sk_test' } as unknown as NodeJS.ProcessEnv;
const base = { prompt: 'a red fox', width: 1024, height: 688, model: 'flux' };

describe('splitImageModels', () => {
  it('drops paid_only and non-image models and splits community', () => {
    const { official, community } = splitImageModels(raw);
    const ids = [...official, ...community].map((m) => m.id);
    expect(ids).not.toContain('black-forest-labs/flux.2-pro');
    expect(ids).not.toContain('google/gemini-3-pro-image');
    expect(ids).not.toContain('community/MarcosFRG/flux-1-schnell:paid');
    expect(ids).not.toContain('heygen/heygen-video-1');
    expect(official.map((m) => m.id)).toContain('black-forest-labs/flux.1-schnell');
    expect(official.every((m) => !m.id.startsWith('community/'))).toBe(true);
    expect(community.map((m) => m.id)).toEqual(
      expect.arrayContaining(['community/MarcosFRG/flux-1-schnell', 'community/MarcosFRG/flux-2-klein-4b']),
    );
    expect(community.every((m) => m.id.startsWith('community/'))).toBe(true);
  });

  it('carries health and whether a model takes a reference image', () => {
    const { official } = splitImageModels(raw);
    const klein = official.find((m) => m.id === 'black-forest-labs/flux.2-klein-4b')!;
    expect(klein.acceptsImage).toBe(true);
    expect(['healthy', 'degraded', 'unknown']).toContain(klein.health);
    const schnell = official.find((m) => m.id === 'black-forest-labs/flux.1-schnell')!;
    expect(schnell.acceptsImage).toBe(false);
  });
});

describe('sizeFor', () => {
  it('keeps the long side at 1024 in multiples of 16', () => {
    expect(sizeFor('3:2')).toEqual({ width: 1024, height: 688 });
    expect(sizeFor('9:16')).toEqual({ width: 576, height: 1024 });
    expect(sizeFor('1:1')).toEqual({ width: 1024, height: 1024 });
  });

  it('falls back to a square for missing or junk ratios', () => {
    expect(sizeFor(undefined)).toEqual({ width: 1024, height: 1024 });
    expect(sizeFor('wide')).toEqual({ width: 1024, height: 1024 });
    expect(sizeFor('0:5')).toEqual({ width: 1024, height: 1024 });
  });
});

describe('imageUrl (keyless route only)', () => {
  it('builds the keyless URL without a model, encoding the prompt', () => {
    const url = new URL(imageUrl({ ...base, model: 'default', prompt: 'a/b? c#d' }));
    expect(url.origin + url.pathname).toBe('https://image.pollinations.ai/prompt/a%2Fb%3F%20c%23d');
    expect(url.searchParams.get('nologo')).toBe('true');
    expect(url.searchParams.has('model')).toBe(false);
    expect(url.hash).toBe('');
  });

  it('cuts very long prompts to what a URL can carry', () => {
    const url = new URL(imageUrl({ ...base, prompt: 'x'.repeat(3000) }));
    expect(decodeURIComponent(url.pathname).length).toBe('/prompt/'.length + MAX_URL_PROMPT_CHARS);
    expect(MAX_URL_PROMPT_CHARS).toBe(1800);
  });
});

describe('generateImage', () => {
  const png = () => sharp({ create: { width: 4, height: 4, channels: 3, background: '#c33' } }).png().toBuffer();

  function fakeFetch(status: number, body: BodyInit | null, type: string) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(body, { status, headers: { 'content-type': type } });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it('POSTs the whole prompt to Pollinations and decodes the image it returns', async () => {
    const bytes = await png();
    const { impl, calls } = fakeFetch(200, JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }), 'application/json');
    const long = 'detailed prompt '.repeat(600);
    const out = await generateImage('pollinations', { ...base, prompt: long, negative: 'text', seed: 9 }, env, impl);
    expect(out.bytes.equals(bytes)).toBe(true);
    expect(out.contentType).toBe('image/png');
    expect(calls[0].url).toBe('https://gen.pollinations.ai/v1/images/generations');
    expect(calls[0].init?.method).toBe('POST');
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe('Bearer sk_test');
    const sent = JSON.parse(String(calls[0].init?.body));
    expect(sent).toMatchObject({ model: 'flux', size: '1024x688', seed: 9, response_format: 'b64_json' });
    expect(sent.prompt).toBe(`${long.trim()}

Avoid: text`);
  });

  it('sends a reference picture to the edits endpoint', async () => {
    const { impl, calls } = fakeFetch(200, JSON.stringify({ data: [{ b64_json: (await png()).toString('base64') }] }), 'application/json');
    await generateImage('pollinations', { ...base, image: 'data:image/jpeg;base64,AAAA' }, env, impl);
    expect(calls[0].url).toBe('https://gen.pollinations.ai/v1/images/edits');
    expect(JSON.parse(String(calls[0].init?.body)).image).toEqual([{ image_url: 'data:image/jpeg;base64,AAAA' }]);
  });

  it('never sends a reference picture through the keyless route', async () => {
    const { impl, calls } = fakeFetch(200, null, 'image/png');
    await expect(generateImage('keyless-url', { ...base, image: 'data:image/jpeg;base64,AAAA' }, env, impl)).rejects.toThrow(/keyless/);
    expect(calls).toHaveLength(0);
  });

  it('cuts prompts to Pollinations’ 32,000-character limit', async () => {
    const { impl, calls } = fakeFetch(200, JSON.stringify({ data: [{ b64_json: (await png()).toString('base64') }] }), 'application/json');
    await generateImage('pollinations-community', { ...base, prompt: 'y'.repeat(40_000) }, env, impl);
    expect(JSON.parse(String(calls[0].init?.body)).prompt.length).toBe(MAX_PROMPT_CHARS);
    expect(MAX_PROMPT_CHARS).toBe(32_000);
  });

  it('fetches the keyless route by URL with no key', async () => {
    const { impl, calls } = fakeFetch(200, new Uint8Array(await png()), 'image/jpeg');
    await generateImage('keyless-url', { ...base, model: 'default' }, env, impl);
    expect(calls[0].url.startsWith('https://image.pollinations.ai/prompt/')).toBe(true);
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBeNull();
  });

  it.each([
    [401, 'auth'],
    [402, 'no_pollen'],
    [429, 'rate_limit'],
    [500, 'server'],
  ] as const)('maps status %i to %s with the body message', async (status, kind) => {
    const { impl } = fakeFetch(status, JSON.stringify({ error: { message: 'upstream said no' } }), 'application/json');
    const error = await generateImage('pollinations', base, env, impl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImagineError);
    expect((error as ImagineError).kind).toBe(kind);
    expect((error as ImagineError).status).toBe(status);
    expect((error as ImagineError).message).toContain('upstream said no');
  });

  it('treats a 200 without image data as not an image', async () => {
    const { impl } = fakeFetch(200, JSON.stringify({ data: [] }), 'application/json');
    const error = await generateImage('pollinations', base, env, impl).catch((e: unknown) => e);
    expect((error as ImagineError).kind).toBe('not_image');
    const html = fakeFetch(200, '<html></html>', 'text/html');
    const error2 = await generateImage('keyless-url', { ...base, model: 'default' }, env, html.impl).catch((e: unknown) => e);
    expect((error2 as ImagineError).kind).toBe('not_image');
  });

  it('refuses to call Pollinations without a key', async () => {
    const { impl, calls } = fakeFetch(200, null, 'image/png');
    const error = await generateImage('pollinations', base, {} as NodeJS.ProcessEnv, impl).catch((e: unknown) => e);
    expect((error as ImagineError).kind).toBe('auth');
    expect(calls).toHaveLength(0);
  });
});

describe('image model health', () => {
  it('treats a mostly failing image model as degraded', () => {
    const { community } = splitImageModels([
      { name: 'community/x/img', community: true, paid_only: false, output_modalities: ['image'], input_modalities: ['text'], health: { status: 'unknown', success_rate: 10 } },
    ]);
    expect(community[0].health).toBe('degraded');
  });
});
