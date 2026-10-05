import { describe, expect, it } from 'vitest';
import { analyze, AnalysisError, planSlices, type AnalyzeDeps, type AnalyzeInput, type OutputBook } from '@/lib/ai/strategy';
import { ProviderError, type ChatRequest, type ChatResult } from '@/lib/ai/client';
import { lensForVersion } from '@/lib/ai/prompts/lenses';
import type { ProviderSetup } from '@/lib/ai/registry';
import type { RateInfo } from '@/lib/ai/ratelimit';
import type { WebSpec } from '@/lib/ai/schema/display';
import { samplePatterns, sampleImageTranslation, sampleObservation, sampleWebTranslation } from './fixtures';

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
      req.schema.name === 'patterns'
        ? { patterns: samplePatterns() }
        : req.schema.name === 'observation'
          ? { ...sampleObservation(mode), ...(mode === 'web' ? { patterns: samplePatterns() } : {}) }
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
    await analyze(input(1), h.deps([twoKeys]));
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
  it('reads patterns and design separately for each frame on a small budget, then translates', async () => {
    const h = harness();
    const result = await analyze(input(2), h.deps([small]));

    expect(h.calls.map((c) => [c.model.id, c.schema.name, c.images?.length ?? 0])).toEqual([
      ['small-vision', 'patterns', 1],
      ['small-vision', 'observation', 1],
      ['small-vision', 'patterns', 1],
      ['small-vision', 'observation', 1],
      ['small-text', 'translation', 0],
    ]);
    expect(result.spec.inspi).toBe('web/2');
    expect(result.identity).toEqual({ name: 'Glass Dusk', category: 'Landing Page', tags: ['frosted glass', 'dusk gradient'] });
    expect(result.provider).toBe('Small');
    expect(result.usage).toEqual({ input: 5000, output: 2500 });
    expect(h.progress.map((p) => p.text)).toEqual([
      'Reading frame 1 of 2: patterns',
      'Reading frame 1 of 2: design',
      'Reading frame 2 of 2: patterns',
      'Reading frame 2 of 2: design',
      'Writing the build spec',
    ]);
    // Frames share one grammar: components are pooled by kind, each frame's page note is kept.
    const web = result.spec as WebSpec;
    expect(web.patterns?.components.map((c) => c.name)).toEqual(['Navigation', 'Hero']);
    expect(web.patterns?.page).toMatch(/^Frame 1: .*Frame 2: /);
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
    expect(h.calls[0].system).toContain('Patterns — the page');
    expect(h.calls[0].system).toContain('Do not quote the page');
    expect(h.progress[0].text).toBe('Reading 3 frames');
    expect((result.spec as WebSpec).patterns?.motif.what).toContain('frosted panels');
  });

  it('asks image analyses for the style only, with no page patterns', async () => {
    const h = harness([], 'image');
    await analyze(input(1, { mode: 'image' }), h.deps([small]));
    expect(h.calls.map((c) => c.schema.name)).toEqual(['observation', 'translation']);
    expect(h.calls[0].system).not.toContain('Patterns —');
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

  it('retries tersely when a patterns answer is cut off', async () => {
    const h = harness([new ProviderError('truncated', 'cut off')]);
    await analyze(input(1), h.deps([small]));
    expect(h.calls).toHaveLength(4);
    const patterns = h.calls.filter((c) => c.schema.name === 'patterns');
    expect(patterns[0].system).not.toContain('Hard limits: at most 14 words');
    expect(patterns[1].system).toContain('Hard limits: at most 14 words');
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
    expect(h.progress[0].text).toBe('Reading the patterns');
  });
});

/** Builds valid data for any JSON schema, so a fake model can answer whatever slice it is asked for. */
function fromSchema(schema: Record<string, unknown>): unknown {
  if (schema.type === 'object') {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    return Object.fromEntries(Object.entries(props).map(([key, value]) => [key, fromSchema(value)]));
  }
  if (schema.type === 'array') return [fromSchema(schema.items as Record<string, unknown>)];
  if (Array.isArray(schema.enum)) return schema.enum[0];
  return schema.type === 'number' ? 0.7 : 'x';
}

describe('planSlices', () => {
  it('packs a web analysis into a few independent slices that each fit the cap', () => {
    const slices = planSlices('web', 1000);
    expect(slices.map((s) => [s.patterns ? 'patterns' : '', s.meta ? 'meta' : ''].filter(Boolean).join('+'))).toEqual(['patterns', 'meta', '']);
    // Every dimension appears exactly once.
    const dims = slices.flatMap((s) => s.dims ?? []);
    expect(dims).toHaveLength(27);
    expect(new Set(dims).size).toBe(27);
  });

  it('needs fewer slices for an image, and a single one when the cap is generous', () => {
    expect(planSlices('image', 1000)).toHaveLength(3);
    expect(planSlices('web', 20000)).toHaveLength(1);
  });
});

describe('a provider that caps output per minute', () => {
  it('learns the cap from the refusal, then asks in paced slices and keeps everything', async () => {
    const calls: ChatRequest<unknown>[] = [];
    const sleeps: number[] = [];
    let clock = 5_000_000;
    const outputs: OutputBook = { caps: new Map(), log: new Map() };
    const chat = async <T,>(req: ChatRequest<T>): Promise<ChatResult<T>> => {
      calls.push(req as ChatRequest<unknown>);
      if (req.schema.name !== 'translation' && req.maxTokens > 1000) {
        throw new ProviderError(
          'too_large',
          'Request too large for model `x` on output tokens per minute (OTPM): Limit 1000, Requested 1842. reduce max_tokens',
          429,
        );
      }
      const raw = req.schema.name === 'translation' ? sampleWebTranslation() : fromSchema(req.schema.json);
      const parsed = req.schema.parse(raw);
      if (!parsed.ok) throw new Error(parsed.issues.join(';'));
      return { data: parsed.data, usage: { input: 1000, output: 900 }, rate: {} };
    };
    const result = await analyze(input(1), {
      chain: [small],
      chat: chat as AnalyzeDeps['chat'],
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
      rates: new Map(),
      outputs,
    });

    expect(outputs.caps.get('groq:small-vision')).toBe(1000);
    const slices = calls.filter((c) => c.schema.name === 'slice');
    expect(slices).toHaveLength(3);
    for (const call of slices) expect(call.maxTokens).toBeLessThanOrEqual(1000);
    // With one key, each slice waits for the minute's output allowance to come back.
    expect(sleeps.filter((ms) => ms > 50_000)).toHaveLength(2);

    const web = result.spec as WebSpec;
    expect(web.patterns?.components[0]).toMatchObject({ name: 'x', importance: 'high' });
    expect(Object.keys(web.system)).toHaveLength(27);
    expect(web.palette.length).toBeGreaterThan(0);
  });
});

describe('call records and guidance', () => {
  it('reports every call, including refused ones, with its step and tokens', async () => {
    const h = harness([new ProviderError('rate_limit', 'slow down', 429, { retryAfterMs: 2000 })]);
    const records: { step: string; ok: boolean; tokensIn: number; model: string; error?: string | null }[] = [];
    await analyze(input(1), { ...h.deps([small]), onCall: (record) => records.push(record) });
    expect(records[0]).toMatchObject({ provider: 'groq', model: 'small-vision', step: 'observe', ok: false, error: 'rate_limit', tokensIn: 0 });
    expect(records.filter((r) => r.ok).map((r) => [r.step, r.model, r.tokensIn])).toEqual([
      ['observe', 'small-vision', 1000],
      ['observe', 'small-vision', 1000],
      ['translate', 'small-text', 1000],
    ]);
  });

  it('puts a guided retry’s note in the observe and translate prompts', async () => {
    const h = harness();
    await analyze(input(1, { steer: { focus: [], note: 'Headline is a condensed grotesque' } }), h.deps([small]));
    for (const call of h.calls) expect(call.system).toContain('Headline is a condensed grotesque');
  });
});

describe('two keys for one capped provider', () => {
  it('runs the slices on both keys at once, so fewer minutes are spent waiting', async () => {
    const calls: ChatRequest<unknown>[] = [];
    const sleeps: number[] = [];
    let clock = 9_000_000;
    let inFlight = 0;
    let most = 0;
    const outputs: OutputBook = { caps: new Map([['groq:small-vision', 1000]]), log: new Map() };
    const chat = async <T,>(req: ChatRequest<T>): Promise<ChatResult<T>> => {
      calls.push(req as ChatRequest<unknown>);
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      const raw = req.schema.name === 'translation' ? sampleWebTranslation() : fromSchema(req.schema.json);
      const parsed = req.schema.parse(raw);
      if (!parsed.ok) throw new Error(parsed.issues.join(';'));
      return { data: parsed.data, usage: { input: 1000, output: 900 }, rate: {} };
    };
    await analyze(input(1), {
      chain: [twoKeys],
      chat: chat as AnalyzeDeps['chat'],
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
      rates: new Map(),
      outputs,
    });

    const slices = calls.filter((c) => c.schema.name === 'slice');
    expect(slices).toHaveLength(3);
    // The cap known for the first key applies to the second as well.
    for (const call of slices) expect(call.maxTokens).toBeLessThanOrEqual(1000);
    expect(new Set(slices.map((c) => c.provider.apiKey))).toEqual(new Set(['first', 'second']));
    expect(most).toBe(2);
    expect(sleeps.filter((ms) => ms > 50_000)).toHaveLength(1);
  });
});
