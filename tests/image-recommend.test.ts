import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL_FACTS, recommendModel, STRONGEST_FIRST } from '@/lib/imagine/recommend';
import type { ImageModel } from '@/lib/imagine/types';
import { openLibrary } from '@/lib/store/library';

const model = (id: string, health: ImageModel['health'] = 'healthy', successRate: number | null = 100): ImageModel => ({
  id,
  label: id.split('/').pop()!,
  acceptsImage: false,
  health,
  successRate,
});

describe('recommendModel', () => {
  it('picks the strongest model that is healthy and has not failed for you', () => {
    const models = [model('black-forest-labs/flux.1-schnell'), model('openai/gpt-image-2'), model('openai/gpt-image-1.5')];
    expect(recommendModel(models, new Set())).toBe('openai/gpt-image-2');
    expect(recommendModel(models, new Set(['openai/gpt-image-2']))).toBe('openai/gpt-image-1.5');
  });

  it('skips degraded models and ones that work less than 95% of the time', () => {
    const models = [model('openai/gpt-image-2', 'degraded', 70), model('openai/gpt-image-1.5', 'healthy', 90), model('microsoft/mai-image-2.6')];
    expect(recommendModel(models, new Set())).toBe('microsoft/mai-image-2.6');
  });

  it('falls back to any healthy model, then to anything listed', () => {
    expect(recommendModel([model('someone/new-model')], new Set())).toBe('someone/new-model');
    expect(recommendModel([model('a/x', 'degraded', 50)], new Set())).toBe('a/x');
    expect(recommendModel([], new Set())).toBeNull();
  });

  it('ranks GPT Image 2 first and FLUX Schnell near the end', () => {
    expect(STRONGEST_FIRST[0]).toBe('openai/gpt-image-2');
    expect(STRONGEST_FIRST.indexOf('black-forest-labs/flux.1-schnell')).toBeGreaterThan(STRONGEST_FIRST.indexOf('black-forest-labs/flux.1.1-pro'));
  });
});

describe('models that failed for you', () => {
  it('lists image models whose latest request in the window failed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inspi-fail-'));
    const lib = openLibrary(dir);
    try {
      const now = Date.now();
      const call = (model: string, ok: boolean, at: number) =>
        lib.recordCall({ at, provider: 'pollinations', model, step: 'imagine', entryId: null, tokensIn: 0, tokensOut: 0, ok, error: ok ? null : 'no_pollen' });
      call('openai/gpt-image-2', false, now - 1000);
      call('openai/gpt-image-1.5', false, now - 5000);
      call('openai/gpt-image-1.5', true, now - 1000);
      call('old/failure', false, now - 2 * 86_400_000);
      expect(lib.failingImageModels(now - 86_400_000)).toEqual(['openai/gpt-image-2']);
    } finally {
      lib.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('AutoPick modes', () => {
  const all = [
    'openai/gpt-image-2',
    'openai/gpt-image-1.5',
    'tongyi-mai/z-image-turbo',
    'openai/gpt-image-1-mini',
    'black-forest-labs/flux.1-schnell',
    'lykon/dreamshaper-8-lcm',
  ].map((id) => model(id));

  it('Strongest takes the highest-rated model', () => {
    expect(recommendModel(all, new Set(), 'strongest')).toBe('openai/gpt-image-2');
  });

  it('Balanced takes the best quality for the Pollen and time it costs', () => {
    // With MAI Image 2.6 Flash removed (5 Oct), GPT Image 2 scores 327 against GPT Image 1.5's 317
    expect(recommendModel(all, new Set(), 'balanced')).toBe('openai/gpt-image-2');
  });

  it('Cheapest takes the cheapest model with a measured quality score', () => {
    expect(recommendModel(all, new Set(), 'cheapest')).toBe('black-forest-labs/flux.1-schnell');
  });

  it('every mode skips a model that just failed for you', () => {
    expect(recommendModel(all, new Set(['openai/gpt-image-2']), 'balanced')).toBe('openai/gpt-image-1.5');
    expect(recommendModel(all, new Set(['black-forest-labs/flux.1-schnell']), 'cheapest')).toBe('tongyi-mai/z-image-turbo');
  });

  it('knows a rating, a price and a time for every ranked model', () => {
    for (const id of STRONGEST_FIRST.slice(0, -1)) {
      const facts = MODEL_FACTS[id];
      expect(facts.elo).toBeGreaterThan(700);
      expect(facts.pollen).toBeGreaterThan(0);
      expect(facts.seconds).toBeGreaterThan(0);
    }
  });
});
