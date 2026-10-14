import { describe, expect, it } from 'vitest';
import raw from './fixtures/pollinations-text-models.json';
import { hasKeys, providerChain, PROVIDER_IDS } from '@/lib/ai/registry';
import { modelListUrl, usableModels } from '@/lib/ai/status';

const env = { POLLINATIONS_API_KEY: 'sk_test' } as unknown as NodeJS.ProcessEnv;

describe('Pollinations as an analysis provider', () => {
  it('is one of the providers', () => {
    expect(PROVIDER_IDS).toContain('pollinations');
  });

  it('drops paid-only models and keeps free community vision models with their health', () => {
    const models = usableModels(raw as unknown as Parameters<typeof usableModels>[0]);
    const ids = models.map((m) => m.id);
    expect(ids).not.toContain('anthropic/claude-sonnet-5.5');
    expect(ids).not.toContain('anthropic/claude-opus-5.5');
    expect(ids).not.toContain('openai/gpt-audio-1.5');
    const qwen = models.find((m) => m.id === 'community/sharktide/inferenceport-ai-qwen-3.8-27b');
    expect(qwen).toMatchObject({ vision: true, free: true, health: 'healthy' });
    expect(models.find((m) => m.id === 'community/vendouple/deepseek-v4-flash')).toMatchObject({ vision: false, free: true });
  });

  it('needs its key', () => {
    expect(hasKeys('pollinations', {} as NodeJS.ProcessEnv)).toBe(false);
    expect(hasKeys('pollinations', env)).toBe(true);
  });

  it('is skipped until a reading model is picked, since Pollinations has no default', () => {
    expect(providerChain(['pollinations'], {}, env)).toEqual([]);
  });

  it('runs the picked models against the OpenAI-compatible endpoint in plain JSON mode', () => {
    const [setup] = providerChain(['pollinations'], { pollinations: { vision: 'community/x', text: 'community/y' } }, env);
    expect(setup.runtime.baseUrl).toBe('https://gen.pollinations.ai/v1');
    expect(setup.vision.id).toBe('community/x');
    expect(setup.text.id).toBe('community/y');
    expect(setup.vision.strict).toBe(false);
    expect(setup.vision.maxTokensParam).toBe('max_tokens');
  });

  it('reads its model list from the text catalogue, unreliable community models included', () => {
    expect(modelListUrl('pollinations', 'https://gen.pollinations.ai/v1', env)).toBe('https://gen.pollinations.ai/text/models?reliability=all');
    expect(modelListUrl('groq', 'https://api.groq.com/openai/v1', env)).toBe('https://api.groq.com/openai/v1/models');
  });
});

describe('Pollinations model choices', () => {
  it('groups models by health, healthy first, so a flaky one is easy to avoid', async () => {
    const { modelChoices } = await import('@/components/settings/model-picker');
    const listing = {
      ok: true,
      message: '',
      models: [
        { id: 'c/flaky', vision: true, free: true, health: 'degraded' as const, successRate: 81 },
        { id: 'a/solid', vision: true, free: true, health: 'healthy' as const, successRate: 100 },
        { id: 'b/new', vision: true, free: true, health: 'unknown' as const, successRate: null },
      ],
    };
    expect(modelChoices('pollinations', listing).vision).toEqual([
      { label: 'Healthy', ids: ['a/solid'] },
      { label: 'Degraded: often fails', ids: ['c/flaky'] },
      { label: 'Not measured yet', ids: ['b/new'] },
    ]);
  });
});

describe('reading a model list payload', () => {
  it('accepts a bare array as well as { data } and { result }', async () => {
    const { modelsFromPayload } = await import('@/lib/ai/status');
    expect(modelsFromPayload([{ name: 'a' }])).toEqual([{ name: 'a' }]);
    expect(modelsFromPayload({ data: [{ id: 'b' }] })).toEqual([{ id: 'b' }]);
    expect(modelsFromPayload({ result: [{ name: 'c' }] })).toEqual([{ name: 'c' }]);
    expect(modelsFromPayload(null)).toEqual([]);
  });
});

describe('health from a measured success rate', () => {
  it('treats a model that mostly fails as degraded even when Pollinations says unknown', () => {
    const [m] = usableModels([
      { name: 'community/x/flaky', input_modalities: ['text', 'image'], output_modalities: ['text'], paid_only: false, health: { status: 'unknown', success_rate: 4 } },
    ] as unknown as Parameters<typeof usableModels>[0]);
    expect(m.health).toBe('degraded');
  });
});
