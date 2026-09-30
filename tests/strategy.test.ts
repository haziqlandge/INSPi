import { describe, expect, it } from 'vitest';
import { analyze, AnalysisError, type AnalyzeDeps, type AnalyzeInput } from '@/lib/ai/strategy';
import { ProviderError, type ChatRequest, type ChatResult } from '@/lib/ai/client';
import { lensForVersion } from '@/lib/ai/prompts/lenses';
import type { ProviderSetup } from '@/lib/ai/registry';
import type { RateInfo } from '@/lib/ai/ratelimit';
import type { WebSpec } from '@/lib/ai/schema/display';
import { sampleBlueprint, sampleImageTranslation, sampleObservation, sampleWebTranslation } from './fixtures';

const model = (id: string, tpm: number, maxImages: number) => ({
  id,
  strict: true,
  maxTokensParam: 'max_completion_tokens' as const,
  maxImages,
  tokensPerImage: maxImages ? 2048 : 0,
  tpm,
  maxOutput: 16384,
});

const small: ProviderSetup = {
  runtime: { id: 'groq', baseUrl: 'https://small.test/v1', apiKey: 'k' },
  label: 'Small',
  vision: model('small-vision', 8000, 3),
  text: model('small-text', 8000, 0),
};

const large: ProviderSetup = {
  runtime: { id: 'gemini', baseUrl: 'https://large.test/v1', apiKey: 'k' },
  label: 'Large',
  vision: model('large-vision', 250000, 9),
  text: model('large-text', 250000, 0),
};

const frame = (n: number, images = 1) => ({ dataUrl: `data:image/jpeg;base64,FRAME${n}`, images });

const input = (frames: number, extra: Partial<AnalyzeInput> = {}): AnalyzeInput => ({
  mode: 'web',
  frames: Array.from({ length: frames }, (_, i) => frame(i + 1)),
  lens: lensForVersion(1),
  knownTags: ['glass'],
  temperature: 0.4,
  ...extra,
});

type Step = { rate?: RateInfo } | ProviderError;

/** A fake model: answers observe and translate requests correctly unless a step says otherwise. */
function harness(steps: Step[] = [], mode: 'web' | 'image' = 'web') {
  const calls: ChatRequest<unknown>[] = [];
  const sleeps: number[] = [];
  const progress: { text: string; waitUntil: number | null }[] = [];
  let clock = 1_000_000;

  const chat = async <T,>(req: ChatRequest<T>): Promise<ChatResult<T>> => {
    calls.push(req as ChatRequest<unknown>);
    const step = steps.shift();
    if (step instanceof ProviderError) throw step;
    const raw =
      req.schema.name === 'blueprint'
        ? { blueprint: sampleBlueprint() }
        : req.schema.name === 'observation'
          ? { ...sampleObservation(mode), ...(mode === 'web' ? { blueprint: sampleBlueprint() } : {}) }
          : mode === 'web'
            ? sampleWebTranslation()
            : sampleImageTranslation();
    const parsed = req.schema.parse(raw);
    if (!parsed.ok) throw new Error(parsed.issues.join(';'));
    return { data: parsed.data, usage: { input: 1000, output: 500 }, rate: step?.rate ?? {} };
  };

  const deps = (chain: ProviderSetup[]): AnalyzeDeps => ({
    chain,
    chat: chat as AnalyzeDeps['chat'],
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    rates: new Map(),
    onProgress: (p) => progress.push(p),
  });

  return { calls, sleeps, progress, deps };
}

const twoKeys: ProviderSetup = { ...small, runtime: { ...small.runtime, apiKey: 'first', fallbackKey: 'second' } };

describe('second key for the same provider', () => {
  it('uses the second key at once while the first waits for its quota window', async () => {
    const h = harness([{ rate: { remainingTokens: 100, resetTokensMs: 30_000 } }]);
    await analyze(input(2), h.deps([twoKeys]));
    expect(h.sleeps).toEqual([]);
    expect(h.calls.slice(0, 2).map((c) => c.provider.apiKey)).toEqual(['first', 'second']);
  });

  it('switches to the second key when the first is out of quota for hours', async () => {
    const h = harness([new ProviderError('rate_limit', 'daily limit', 429, { retryAfterMs: 3 * 3_600_000 })]);
    const result = await analyze(input(1), h.deps([twoKeys]));
    expect(result.provider).toBe('Small');
    expect(h.calls.map((c) => c.provider.apiKey)).toEqual(['first', 'second', 'second', 'second']);
    expect(h.sleeps).toEqual([]);
  });

  it('switches to the second key when the first is rejected, and says so if both are', async () => {
    const h = harness([new ProviderError('auth', 'bad', 401)]);
    const result = await analyze(input(1), h.deps([twoKeys]));
    expect(result.provider).toBe('Small');
    expect(h.calls[1].provider.apiKey).toBe('second');

    const both = harness([new ProviderError('auth', 'bad', 401), new ProviderError('auth', 'bad', 401)]);
    await expect(analyze(input(1), both.deps([twoKeys]))).rejects.toThrow(/Small: the API key was rejected/);
  });
});

describe('analyze', () => {
  it('reads layout and design separately for each frame on a small budget, then translates', async () => {
    const h = harness();
    const result = await analyze(input(2), h.deps([small]));

    expect(h.calls.map((c) => [c.model.id, c.schema.name, c.images?.length ?? 0])).toEqual([
      ['small-vision', 'blueprint', 1],
      ['small-vision', 'observation', 1],
      ['small-vision', 'blueprint', 1],
      ['small-vision', 'observation', 1],
      ['small-text', 'translation', 0],
    ]);
    expect(result.spec.inspi).toBe('web/1');
    expect(result.identity).toEqual({ name: 'Glass Dusk', category: 'Landing Page', tags: ['frosted glass', 'dusk gradient'] });
    expect(result.provider).toBe('Small');
    expect(result.usage).toEqual({ input: 5000, output: 2500 });
    expect(h.progress.map((p) => p.text)).toEqual([
      'Reading frame 1 of 2: layout',
      'Reading frame 1 of 2: design',
      'Reading frame 2 of 2: layout',
      'Reading frame 2 of 2: design',
      'Writing the build spec',
    ]);
    // Each frame's sections are kept, named by frame.
    const web = result.spec as WebSpec;
    expect(web.blueprint?.sections.map((s) => s.name)).toEqual(['Frame 1: Header', 'Frame 1: Hero', 'Frame 2: Header', 'Frame 2: Hero']);
  });

  it('never asks for more tokens than the per-minute allowance', async () => {
    const h = harness();
    await analyze(input(1), h.deps([small]));
    for (const call of h.calls) {
      const prompt = Math.ceil((call.system.length + call.user.length) / 3.6);
      const images = (call.images?.length ?? 0) * 2048;
      expect(prompt + images + call.maxTokens).toBeLessThanOrEqual(8000);
    }
  });

  it('sends all frames in one observe call, layout and design together, when the budget allows', async () => {
    const h = harness();
    const result = await analyze(input(3), h.deps([large]));
    expect(h.calls.map((c) => [c.schema.name, c.images?.length ?? 0])).toEqual([
      ['observation', 3],
      ['translation', 0],
    ]);
    expect(h.calls[0].system).toContain('Return the blueprint');
    expect(h.progress[0].text).toBe('Reading 3 frames');
    expect((result.spec as WebSpec).blueprint?.sections[0].name).toBe('Header');
  });

  it('asks image analyses for the style only, with no blueprint', async () => {
    const h = harness([], 'image');
    await analyze(input(1, { mode: 'image' }), h.deps([small]));
    expect(h.calls.map((c) => c.schema.name)).toEqual(['observation', 'translation']);
    expect(h.calls[0].system).not.toContain('blueprint');
  });

  it('waits for the token window the previous answer reported', async () => {
    const h = harness([{ rate: { remainingTokens: 100, resetTokensMs: 30_000 } }]);
    await analyze(input(2), h.deps([small]));
    expect(h.sleeps).toEqual([30_500]);
    const waiting = h.progress.find((p) => p.waitUntil !== null)!;
    expect(waiting.text).toBe('Waiting for Small quota');
    expect(waiting.waitUntil).toBe(1_000_000 + 30_500);
  });

  it('waits and retries after a 429', async () => {
    const h = harness([new ProviderError('rate_limit', 'slow down', 429, { retryAfterMs: 12_000 })]);
    const result = await analyze(input(1), h.deps([small]));
    expect(h.sleeps).toEqual([12_500]);
    expect(h.calls).toHaveLength(4);
    expect(result.provider).toBe('Small');
  });

  it('moves to the next provider when a quota would take too long to come back', async () => {
    const h = harness([new ProviderError('rate_limit', 'daily limit', 429, { retryAfterMs: 3 * 3_600_000 })]);
    const result = await analyze(input(1), h.deps([small, large]));
    expect(h.sleeps).toEqual([]);
    expect(result.provider).toBe('Large');
  });

  it('moves to the next provider on a bad key', async () => {
    const h = harness([new ProviderError('auth', 'invalid api key', 401)]);
    const result = await analyze(input(1), h.deps([small, large]));
    expect(result.provider).toBe('Large');
    expect(result.model).toBe('large-vision');
  });

  it('retries tersely when a design answer is cut off', async () => {
    const h = harness([{}, new ProviderError('truncated', 'cut off')]);
    await analyze(input(1), h.deps([small]));
    expect(h.calls).toHaveLength(4);
    expect(h.calls[1].system).toContain('Limits: v 14 words');
    expect(h.calls[2].system).toContain('Hard limits: v 8 words');
  });

  it('retries tersely when a layout answer is cut off', async () => {
    const h = harness([new ProviderError('truncated', 'cut off')]);
    await analyze(input(1), h.deps([small]));
    expect(h.calls).toHaveLength(4);
    expect(h.calls[0].system).not.toContain('Hard limits: at most 12 words');
    expect(h.calls[1].system).toContain('Hard limits: at most 12 words');
  });

  it('explains every failure when no provider works', async () => {
    const h = harness([new ProviderError('auth', 'invalid api key', 401), new ProviderError('server', 'boom', 500), new ProviderError('server', 'boom', 500)]);
    const error = await analyze(input(1), h.deps([small, large])).catch((e) => e);
    expect(error).toBeInstanceOf(AnalysisError);
    expect(error.reasons).toHaveLength(2);
    expect(error.message).toMatch(/Small/);
    expect(error.message).toMatch(/Large/);
  });

  it('fails clearly when there is no provider at all', async () => {
    const h = harness();
    await expect(analyze(input(1), h.deps([]))).rejects.toThrow(/No AI provider/);
  });

  it('keeps the entry identity and feeds the old signature into a retry', async () => {
    const h = harness();
    const identity = { name: 'Kept Name', category: 'Poster & Print' as const, tags: ['kept'] };
    const result = await analyze(
      input(1, { identity, previousSignature: ['stepped panels'], lens: lensForVersion(2), temperature: 0.8 }),
      h.deps([small]),
    );
    expect(result.identity).toEqual(identity);
    expect(result.spec.name).toBe('Kept Name');
    expect(h.calls[0].system).toContain('A previous pass concluded: stepped panels');
    expect(h.calls[0].system).toContain('Emphasis for this pass: structure');
    expect(h.calls[0].temperature).toBe(0.8);
  });

  it('tells the model when a frame is a contact sheet', async () => {
    const h = harness();
    await analyze({ ...input(0), frames: [frame(1, 3)] }, h.deps([small]));
    expect(h.calls[0].system).toContain('contact sheet');
    expect(h.progress[0].text).toBe('Reading the layout');
  });
});
