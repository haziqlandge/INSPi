import { describe, expect, it } from 'vitest';
import { modelChoices } from '@/components/settings/model-picker';
import { providerChain } from '@/lib/ai/registry';
import { usableModels } from '@/lib/ai/status';

describe('usableModels', () => {
  it('keeps Groq chat models, reads vision from its modalities and drops the rest', () => {
    const groq = usableModels([
      { id: 'qwen/qwen3.8-27b', context_window: 131072, input_modalities: ['text', 'image'], output_modalities: ['text'] },
      { id: 'openai/gpt-oss-120b', context_window: 131072, input_modalities: ['text'], output_modalities: ['text'] },
      { id: 'openai/gpt-oss-20b', context_window: 131072, input_modalities: ['text'], output_modalities: ['text'] },
      { id: 'openai/gpt-oss-safeguard-20b', context_window: 131072, input_modalities: ['text'], output_modalities: ['text'] },
      { id: 'allam-2-7b', context_window: 4096, input_modalities: ['text'], output_modalities: ['text'] },
      { id: 'meta-llama/llama-prompt-guard-2-86m', context_window: 512, input_modalities: ['text'], output_modalities: ['text'] },
      { id: 'whisper-large-v3', context_window: 448, input_modalities: ['audio'], output_modalities: ['transcription'] },
      { id: 'canopylabs/orpheus-v1-english', context_window: 4000, input_modalities: ['text'], output_modalities: ['speech'] },
    ]);
    expect(groq).toEqual([
      { id: 'openai/gpt-oss-120b', vision: false, free: null },
      { id: 'openai/gpt-oss-20b', vision: false, free: null },
      { id: 'qwen/qwen3.8-27b', vision: true, free: null },
    ]);
  });

  it('drops OpenRouter image and audio generators, routers, aliases and batch variants', () => {
    const arch = (inputs: string[], outputs = ['text']) => ({ input_modalities: inputs, output_modalities: outputs });
    const free = { prompt: '0', completion: '0' };
    const ids = usableModels([
      { id: 'google/gemma-4-31b-it:free', architecture: arch(['text', 'image']), pricing: free, context_length: 262144 },
      { id: 'google/gemini-3.1-flash-image', architecture: arch(['text', 'image'], ['image', 'text']), pricing: { prompt: '0.3' } },
      { id: 'google/lyria-3-pro-preview', architecture: arch(['text', 'image'], ['text', 'audio']), pricing: free },
      { id: 'openai/gpt-audio', architecture: arch(['text', 'audio'], ['text', 'audio']), pricing: { prompt: '2' } },
      { id: 'openrouter/free', architecture: arch(['text', 'image']), pricing: free },
      { id: '~google/gemini-flash-latest', architecture: arch(['text', 'image']), pricing: { prompt: '0.3' } },
      { id: 'openai/gpt-5-mini:batch', architecture: arch(['text', 'image']), pricing: { prompt: '0.1' } },
      { id: 'meta-llama/llama-guard-4-12b', architecture: arch(['text', 'image']), pricing: { prompt: '0.1' } },
      { id: 'openai/gpt-5-mini', architecture: arch(['text', 'image']), pricing: { prompt: '0.1' }, context_length: 400000 },
    ]).map((m) => [m.id, m.vision, m.free]);
    expect(ids).toEqual([
      ['google/gemma-4-31b-it', true, true],
      ['openai/gpt-5-mini', true, false],
    ]);
  });

  it('lists OpenRouter free models by their plain id, merged with the paid listing', () => {
    const arch = { input_modalities: ['text', 'image'], output_modalities: ['text'] };
    const ids = usableModels([
      { id: 'google/gemma-4-31b-it', architecture: arch, pricing: { prompt: '0.1' } },
      { id: 'google/gemma-4-31b-it:free', architecture: arch, pricing: { prompt: '0', completion: '0' } },
    ]).map((m) => [m.id, m.free]);
    expect(ids).toEqual([['google/gemma-4-31b-it', true]]);
  });

  it('keeps only Cloudflare models that answer in text', () => {
    const ids = usableModels([
      { name: '@cf/meta/llama-3.2-11b-vision-instruct', task: { name: 'Text Generation' } },
      { name: '@cf/llava-hf/llava-1.5-7b-hf', task: { name: 'Image-to-Text' } },
      { name: '@cf/black-forest-labs/flux-1-schnell', task: { name: 'Text-to-Image' } },
      { name: '@cf/baai/bge-m3', task: { name: 'Text Embeddings' } },
    ]).map((m) => [m.id, m.vision]);
    expect(ids).toEqual([
      ['@cf/llava-hf/llava-1.5-7b-hf', true],
      ['@cf/meta/llama-3.2-11b-vision-instruct', true],
    ]);
  });
});

describe('modelChoices', () => {
  const listing = (models: { id: string; vision: boolean | null; free: boolean | null }[]) => ({ ok: true, models, message: '' });

  it('offers only image readers for reading, every chat model for writing', () => {
    const choices = modelChoices(
      'groq',
      listing([
        { id: 'openai/gpt-oss-120b', vision: false, free: null },
        { id: 'qwen/qwen3.8-27b', vision: true, free: null },
      ]),
    );
    expect(choices.vision).toEqual([{ label: '', ids: ['qwen/qwen3.8-27b'] }]);
    expect(choices.text).toEqual([{ label: '', ids: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'] }]);
  });

  it('splits OpenRouter into free and paid, free first', () => {
    const choices = modelChoices(
      'openrouter',
      listing([
        { id: 'a/paid', vision: true, free: false },
        { id: 'b/model:free', vision: true, free: true },
        { id: 'c/text:free', vision: false, free: true },
      ]),
    );
    expect(choices.vision).toEqual([
      { label: 'Free', ids: ['b/model:free'] },
      { label: 'Paid: uses OpenRouter credit', ids: ['a/paid'] },
    ]);
    expect(choices.text[0]).toEqual({ label: 'Free', ids: ['b/model:free', 'c/text:free'] });
  });
});

describe('model profiles', () => {
  const env = { GROQ_API_KEY: 'a' } as unknown as NodeJS.ProcessEnv;

  it('keeps schema enforcement and the reasoning switch for a known Groq model in either job', () => {
    const [chain] = providerChain(['groq'], { groq: { text: 'qwen/qwen3.8-27b' } }, env);
    expect(chain.text).toMatchObject({ id: 'qwen/qwen3.8-27b', strict: true, extraBody: { reasoning_effort: 'none' } });
    const [small] = providerChain(['groq'], { groq: { text: 'openai/gpt-oss-20b' } }, env);
    expect(small.text).toMatchObject({ strict: true, extraBody: { reasoning_effort: 'low' } });
  });
});
