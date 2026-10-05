import { readRateInfo, type RateInfo } from './ratelimit';
import type { Parsed } from './schema/wire';

export type ProviderId = 'groq' | 'gemini' | 'openrouter' | 'cloudflare' | 'pollinations';

export interface ProviderRuntime {
  id: ProviderId;
  /** OpenAI-compatible base, without a trailing slash. */
  baseUrl: string;
  apiKey: string;
  /** A second key for the same provider (another account), used when the first is out of quota or rejected. */
  fallbackKey?: string;
}

export interface ModelRuntime {
  id: string;
  /** Whether the provider enforces a JSON schema with constrained decoding. */
  strict: boolean;
  maxTokensParam: 'max_completion_tokens' | 'max_tokens';
  /** Provider-specific switches, e.g. turning reasoning off. */
  extraBody?: Record<string, unknown>;
}

export type ErrorKind =
  | 'rate_limit'
  | 'too_large'
  | 'auth'
  | 'bad_request'
  | 'server'
  | 'network'
  | 'truncated'
  | 'invalid_output';

export class ProviderError extends Error {
  constructor(
    public kind: ErrorKind,
    message: string,
    public status: number | null = null,
    public rate: RateInfo = {},
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ChatRequest<T> {
  provider: ProviderRuntime;
  model: ModelRuntime;
  system: string;
  user: string;
  /** Data URLs, sent after the text. */
  images?: string[];
  schema: {
    name: string;
    json: Record<string, unknown>;
    /** One-line skeleton of the JSON, used when the schema itself cannot be enforced. */
    shape: string;
    parse: (raw: unknown) => Parsed<T>;
  };
  maxTokens: number;
  temperature: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface ChatResult<T> {
  data: T;
  usage: { input: number; output: number };
  rate: RateInfo;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: unknown;
}

interface RawReply {
  content: string;
  finish: string;
  usage: { input: number; output: number };
  rate: RateInfo;
}

function kindFor(status: number, message = ''): ErrorKind {
  // Groq answers 429 when a request alone exceeds a per-minute limit; waiting cannot fix that.
  if (status === 413 || /request too large/i.test(message)) return 'too_large';
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'server';
  return 'bad_request';
}

/** The provider's own words. OpenRouter wraps the upstream host's message in `metadata.raw`. */
function errorDetail(error: unknown): string {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const { message, metadata } = error as { message?: string; metadata?: { raw?: unknown; provider_name?: string } };
  const raw = typeof metadata?.raw === 'string' ? metadata.raw : '';
  const host = metadata?.provider_name ? `${metadata.provider_name}: ` : '';
  return raw ? `${message ?? 'Error'} (${host}${raw})` : (message ?? '');
}

async function send<T>(req: ChatRequest<T>, messages: Message[], strict: boolean): Promise<RawReply> {
  const fetchImpl = req.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {
    model: req.model.id,
    messages,
    temperature: req.temperature,
    [req.model.maxTokensParam]: req.maxTokens,
    response_format: strict
      ? { type: 'json_schema', json_schema: { name: req.schema.name, strict: true, schema: req.schema.json } }
      : { type: 'json_object' },
    ...req.model.extraBody,
  };

  let response: Response;
  try {
    response = await fetchImpl(`${req.provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${req.provider.apiKey}` },
      body: JSON.stringify(body),
      signal: req.signal,
    });
  } catch (cause) {
    throw new ProviderError('network', `Could not reach ${req.provider.id}: ${(cause as Error).message}`);
  }

  const rate = readRateInfo(response.headers);
  const payload = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string; metadata?: { raw?: unknown; provider_name?: string } } | string;
  } | null;

  if (!response.ok) {
    const detail = errorDetail(payload?.error) || `${req.provider.id} returned ${response.status}`;
    throw new ProviderError(kindFor(response.status, detail), detail, response.status, rate);
  }

  const choice = payload?.choices?.[0];
  return {
    content: choice?.message?.content ?? '',
    finish: choice?.finish_reason ?? 'stop',
    usage: { input: payload?.usage?.prompt_tokens ?? 0, output: payload?.usage?.completion_tokens ?? 0 },
    rate,
  };
}

function parseJson(content: string): unknown {
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
}

function messagesFor<T>(req: ChatRequest<T>, strict: boolean): Message[] {
  const system = strict
    ? req.system
    : `${req.system}\n\nReturn one JSON object with exactly this shape:\n${req.schema.shape}`;
  const user = req.images?.length
    ? [{ type: 'text', text: req.user }, ...req.images.map((url) => ({ type: 'image_url', image_url: { url } }))]
    : req.user;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * One structured chat completion against any OpenAI-compatible provider.
 * Falls back to plain JSON mode if the schema is rejected, and asks once for a repair if the
 * answer does not validate.
 */
export async function chatJson<T>(req: ChatRequest<T>): Promise<ChatResult<T>> {
  let strict = req.model.strict;
  let messages = messagesFor(req, strict);
  let reply: RawReply;

  try {
    reply = await send(req, messages, strict);
  } catch (error) {
    // Some models advertise schemas they then refuse; plain JSON mode still works.
    if (!(strict && error instanceof ProviderError && error.kind === 'bad_request' && error.status === 400)) throw error;
    strict = false;
    messages = messagesFor(req, strict);
    reply = await send(req, messages, strict);
  }

  if (reply.finish === 'length') {
    throw new ProviderError('truncated', 'The answer was cut off before it finished.', null, reply.rate);
  }

  const usage = { ...reply.usage };
  let parsed = req.schema.parse(parseJson(reply.content));

  if (!parsed.ok) {
    const issues = parsed.issues.join('; ');
    const repair = await send(
      req,
      [
        ...messages,
        { role: 'assistant', content: reply.content },
        { role: 'user', content: `That JSON was not valid: ${issues}. Return the corrected JSON object only.` },
      ],
      strict,
    );
    usage.input += repair.usage.input;
    usage.output += repair.usage.output;
    reply = repair;
    if (repair.finish === 'length') {
      throw new ProviderError('truncated', 'The answer was cut off before it finished.', null, repair.rate);
    }
    parsed = req.schema.parse(parseJson(repair.content));
    if (!parsed.ok) {
      throw new ProviderError('invalid_output', `The model returned JSON that does not fit: ${parsed.issues.join('; ')}`, null, repair.rate);
    }
  }

  return { data: parsed.data, usage, rate: reply.rate };
}
