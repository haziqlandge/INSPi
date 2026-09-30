import { describe, expect, it } from 'vitest';
import { chatJson, ProviderError, type ChatRequest } from '@/lib/ai/client';

interface Shape { answer: string }

const schema: ChatRequest<Shape>['schema'] = {
  name: 'answer',
  json: {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
  },
  shape: '{"answer": string}',
  parse: (raw) => {
    const value = raw as Partial<Shape> | null;
    return value && typeof value.answer === 'string'
      ? { ok: true, data: { answer: value.answer } }
      : { ok: false, issues: ['answer: expected string'] };
  },
};

const provider = { id: 'groq' as const, baseUrl: 'https://api.example.test/v1', apiKey: 'test-key' };
const strictModel = { id: 'vision-model', strict: true, maxTokensParam: 'max_completion_tokens' as const, extraBody: { reasoning_effort: 'none' } };
const looseModel = { id: 'loose-model', strict: false, maxTokensParam: 'max_tokens' as const };

function reply(content: string, init: { status?: number; headers?: Record<string, string>; finish?: string } = {}) {
  const status = init.status ?? 200;
  const body =
    status === 200
      ? { choices: [{ message: { content }, finish_reason: init.finish ?? 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } }
      : { error: { message: content } };
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...init.headers } });
}

function fakeFetch(responses: Response[]) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)),
    });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra call');
    return next;
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

const base = { provider, system: 'You answer.', user: 'Question?', schema, maxTokens: 500, temperature: 0.4 };

describe('chatJson', () => {
  it('sends a strict schema request and returns data, usage and rate info', async () => {
    const { fetchImpl, calls } = fakeFetch([
      reply('{"answer":"yes"}', { headers: { 'x-ratelimit-remaining-tokens': '1200', 'x-ratelimit-reset-tokens': '30s' } }),
    ]);
    const result = await chatJson<Shape>({ ...base, model: strictModel, fetchImpl });

    expect(result.data).toEqual({ answer: 'yes' });
    expect(result.usage).toEqual({ input: 100, output: 20 });
    expect(result.rate.remainingTokens).toBe(1200);

    const call = calls[0];
    expect(call.url).toBe('https://api.example.test/v1/chat/completions');
    expect(call.headers.authorization).toBe('Bearer test-key');
    expect(call.body.model).toBe('vision-model');
    expect(call.body.max_completion_tokens).toBe(500);
    expect(call.body.reasoning_effort).toBe('none');
    expect(call.body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'answer', strict: true, schema: schema.json },
    });
  });

  it('attaches images as data-url parts after the text', async () => {
    const { fetchImpl, calls } = fakeFetch([reply('{"answer":"yes"}')]);
    await chatJson<Shape>({ ...base, model: strictModel, images: ['data:image/jpeg;base64,AAAA'], fetchImpl });
    const messages = calls[0].body.messages as { role: string; content: unknown }[];
    expect(messages[0]).toEqual({ role: 'system', content: 'You answer.' });
    expect(messages[1].content).toEqual([
      { type: 'text', text: 'Question?' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
    ]);
  });

  it('uses JSON mode with a shape hint for models without strict schemas', async () => {
    const { fetchImpl, calls } = fakeFetch([reply('```json\n{"answer":"yes"}\n```')]);
    const result = await chatJson<Shape>({ ...base, model: looseModel, fetchImpl });
    expect(result.data.answer).toBe('yes');
    expect(calls[0].body.response_format).toEqual({ type: 'json_object' });
    expect(calls[0].body.max_tokens).toBe(500);
    const system = (calls[0].body.messages as { content: string }[])[0].content;
    expect(system).toContain('{"answer": string}');
  });

  it('falls back to JSON mode when the provider rejects the strict schema', async () => {
    const { fetchImpl, calls } = fakeFetch([
      reply('json_schema is not supported for this model', { status: 400 }),
      reply('{"answer":"yes"}'),
    ]);
    const result = await chatJson<Shape>({ ...base, model: strictModel, fetchImpl });
    expect(result.data.answer).toBe('yes');
    expect(calls).toHaveLength(2);
    expect(calls[1].body.response_format).toEqual({ type: 'json_object' });
  });

  it('asks once for a repair when the output fails validation', async () => {
    const { fetchImpl, calls } = fakeFetch([reply('{"wrong":1}'), reply('{"answer":"fixed"}')]);
    const result = await chatJson<Shape>({ ...base, model: looseModel, fetchImpl });
    expect(result.data.answer).toBe('fixed');
    const repair = calls[1].body.messages as { role: string; content: string }[];
    expect(repair.at(-1)!.content).toMatch(/answer: expected string/);
    expect(result.usage).toEqual({ input: 200, output: 40 });
  });

  it('gives up with invalid_output after a failed repair', async () => {
    const { fetchImpl } = fakeFetch([reply('not json'), reply('{"wrong":1}')]);
    await expect(chatJson<Shape>({ ...base, model: looseModel, fetchImpl })).rejects.toMatchObject({ kind: 'invalid_output' });
  });

  it('maps HTTP failures to error kinds', async () => {
    const cases: [number, string, Record<string, string>][] = [
      [429, 'rate_limit', { 'retry-after': '12' }],
      [413, 'too_large', {}],
      [401, 'auth', {}],
      [403, 'auth', {}],
      [500, 'server', {}],
      [404, 'bad_request', {}],
    ];
    for (const [status, kind, headers] of cases) {
      const { fetchImpl } = fakeFetch([reply('nope', { status, headers })]);
      const error = await chatJson<Shape>({ ...base, model: looseModel, fetchImpl }).catch((e) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error.kind, String(status)).toBe(kind);
      if (status === 429) expect(error.rate.retryAfterMs).toBe(12000);
    }
  });

  it('reports truncation instead of trying to parse half an answer', async () => {
    const { fetchImpl } = fakeFetch([reply('{"answer":"ye', { finish: 'length' })]);
    await expect(chatJson<Shape>({ ...base, model: strictModel, fetchImpl })).rejects.toMatchObject({ kind: 'truncated' });
  });

  it('wraps network failures', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(chatJson<Shape>({ ...base, model: looseModel, fetchImpl })).rejects.toMatchObject({ kind: 'network' });
  });
});
