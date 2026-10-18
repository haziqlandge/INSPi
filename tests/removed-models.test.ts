import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { imageModels } from '@/lib/imagine/catalog';
import { MODEL_FACTS, recommendModel } from '@/lib/imagine/recommend';
import { REMOVED_IMAGE_MODELS, removedImageModels } from '@/lib/imagine/removed';
import { runImagine } from '@/lib/imagine/run';
import { ImagineError, type ImageModel } from '@/lib/imagine/types';
import { readSettings } from '@/lib/settings';
import { openLibrary, type Library } from '@/lib/store/library';

let dir: string;
let lib: Library;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'inspi-removed-'));
  lib = openLibrary(dir);
  delete (globalThis as { __inspiImageCatalog?: unknown }).__inspiImageCatalog;
});
afterEach(() => {
  lib.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = (model: string, ok: boolean, error: string | null, at = Date.now()) =>
  lib.recordCall({ at, provider: 'pollinations', model, step: 'imagine', entryId: null, tokensIn: 0, tokensOut: 0, ok, error });

const raw = (name: string, community = false) => ({ name, title: name.split('/').pop(), community, paid_only: false, output_modalities: ['image'], health: { status: 'healthy', success_rate: 100 } });
const catalogFetch = (items: unknown[]) => (async () => new Response(JSON.stringify(items), { status: 200 })) as unknown as typeof fetch;

describe('models removed for server errors (user verified, 5 Oct 2026)', () => {
  it('lists the 19 models that only ever failed with server errors', () => {
    expect(REMOVED_IMAGE_MODELS.size).toBe(19);
    expect(REMOVED_IMAGE_MODELS.has('microsoft/mai-image-2.6-flash')).toBe(true);
    expect(REMOVED_IMAGE_MODELS.has('community/tomdacatto/nano-banana-pro')).toBe(true);
    expect(REMOVED_IMAGE_MODELS.has('openai/gpt-image-2')).toBe(false);
  });

  it('never reach a picker: the catalogue drops them', async () => {
    const fetchImpl = catalogFetch([raw('openai/gpt-image-2'), raw('microsoft/mai-image-2.6'), raw('community/tomdacatto/sana', true), raw('community/MarcosFRG/lucid-origin', true)]);
    expect((await imageModels('pollinations', fetchImpl)).map((m) => m.id)).toEqual(['openai/gpt-image-2']);
    expect((await imageModels('pollinations-community', fetchImpl)).map((m) => m.id)).toEqual(['community/MarcosFRG/lucid-origin']);
  });

  it('drops a newly failing model passed in as removed too', async () => {
    const fetchImpl = catalogFetch([raw('openai/gpt-image-2'), raw('someone/new-model')]);
    const removed = new Set([...REMOVED_IMAGE_MODELS, 'someone/new-model']);
    expect((await imageModels('pollinations', fetchImpl, removed)).map((m) => m.id)).toEqual(['openai/gpt-image-2']);
  });
});

describe('the server-only rule, from the usage log', () => {
  it('removes a model whose every call was a server error', () => {
    call('a/only-server', false, 'server');
    call('b/only-5xx', false, 'server:502');
    call('c/server-then-ok', false, 'server');
    call('c/server-then-ok', true, null);
    call('d/rate-limited', false, 'rate_limit');
    call('e/no-pollen', false, 'no_pollen');
    call('f/bad-request', false, 'server:400');
    call('g/local-failure', false, 'internal');
    expect(lib.serverOnlyImageModels()).toEqual(['a/only-server', 'b/only-5xx']);
  });

  it('unites the verified list with the rule', () => {
    call('someone/new-model', false, 'server:503');
    const removed = removedImageModels(lib);
    expect(removed.has('someone/new-model')).toBe(true);
    expect(removed.has('microsoft/mai-image-2.6')).toBe(true);
  });
});

describe('the usage log tells a server error from a local one', () => {
  it('records server:<status> for an HTTP 5xx and internal for anything local', async () => {
    const throwing = (error: Error) => async () => {
      throw error;
    };
    await expect(runImagine({ backend: 'pollinations', model: 'm/a', prompt: 'x' }, { lib, generate: throwing(new ImagineError('server', 'Pollinations answered 503.', 503)) })).rejects.toThrow();
    await expect(runImagine({ backend: 'pollinations', model: 'm/b', prompt: 'x' }, { lib, generate: throwing(new Error('sharp broke')) })).rejects.toThrow();
    await expect(runImagine({ backend: 'pollinations', model: 'm/c', prompt: 'x' }, { lib, generate: throwing(new ImagineError('server', 'No picture to show.')) })).rejects.toThrow();
    const byModel = Object.fromEntries(lib.recentCalls(5).map((c) => [c.model, c.error]));
    expect(byModel).toEqual({ 'm/a': 'server:503', 'm/b': 'internal', 'm/c': 'internal' });
  });
});

describe('AutoPick and saved choices', () => {
  const model = (id: string): ImageModel => ({ id, label: id, acceptsImage: false, health: 'healthy', successRate: 100 });

  it('has no ranking facts for the MAI models, so Balanced picks something that runs', () => {
    expect(MODEL_FACTS['microsoft/mai-image-2.6']).toBeUndefined();
    expect(MODEL_FACTS['microsoft/mai-image-2.6-flash']).toBeUndefined();
    const live = ['openai/gpt-image-2', 'openai/gpt-image-1.5', 'tongyi-mai/z-image-turbo', 'black-forest-labs/flux.1-schnell'].map(model);
    expect(recommendModel(live, new Set(), 'balanced')).not.toMatch(/mai-image/);
  });

  it('reads a saved choice of a removed model as AutoPick Strongest', () => {
    lib.setSetting('settings', { imagine: { backend: 'pollinations', model: 'microsoft/mai-image-2.6-flash', auto: false } });
    expect(readSettings(lib).imagine.auto).toBe('strongest');
  });
});
