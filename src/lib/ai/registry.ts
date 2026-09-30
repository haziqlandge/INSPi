import type { ModelRuntime, ProviderId, ProviderRuntime } from './client';

export interface ModelSpec extends ModelRuntime {
  /** Most images one request accepts. */
  maxImages: number;
  tokensPerImage: number;
  /** Tokens per minute the account is allowed (input + requested output). */
  tpm: number;
  maxOutput: number;
}

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  /** Environment variables that must all be set for the provider to be usable. */
  keyEnv: string[];
  keyUrl: string;
  baseUrl: (env: NodeJS.ProcessEnv) => string;
  apiKey: (env: NodeJS.ProcessEnv) => string | undefined;
  /** Optional second key for the same provider, for when the first one is out of quota. */
  fallbackKey: (env: NodeJS.ProcessEnv) => string | undefined;
  vision: ModelSpec;
  text: ModelSpec;
  /** False until the numbers below have been checked against a live key. */
  verified: boolean;
  note: string;
}

export const PROVIDER_IDS: ProviderId[] = ['groq', 'gemini', 'openrouter', 'cloudflare'];

/**
 * Model ids and limits live here and nowhere else. Groq retired its vision model three times in
 * 2026; when that happens again, change the id below or override it in Settings.
 * Limits marked unverified are assumptions until `npm run check-providers` is run with a key.
 */
export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  groq: {
    id: 'groq',
    label: 'Groq',
    keyEnv: ['GROQ_API_KEY'],
    keyUrl: 'https://console.groq.com/keys',
    baseUrl: (env) => env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    apiKey: (env) => env.GROQ_API_KEY,
    fallbackKey: (env) => env.GROQ_API_KEY_FALLBACK,
    vision: {
      id: 'qwen/qwen3.8-27b',
      strict: true,
      maxTokensParam: 'max_completion_tokens',
      // Thinking would be billed against the same small output allowance.
      extraBody: { reasoning_effort: 'none' },
      maxImages: 3,
      tokensPerImage: 2048,
      tpm: 8000,
      maxOutput: 16384,
    },
    text: {
      id: 'openai/gpt-oss-120b',
      strict: true,
      maxTokensParam: 'max_completion_tokens',
      extraBody: { reasoning_effort: 'low' },
      maxImages: 0,
      tokensPerImage: 0,
      tpm: 8000,
      maxOutput: 65536,
    },
    verified: true,
    note: 'Free tier: 8K tokens a minute and 200K a day per model, about 25 analyses a day.',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    keyEnv: ['GEMINI_API_KEY'],
    keyUrl: 'https://aistudio.google.com/apikey',
    baseUrl: (env) => env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: (env) => env.GEMINI_API_KEY,
    fallbackKey: (env) => env.GEMINI_API_KEY_FALLBACK,
    vision: {
      id: 'gemini-flash-latest',
      strict: false,
      maxTokensParam: 'max_tokens',
      maxImages: 9,
      tokensPerImage: 1300,
      tpm: 250000,
      maxOutput: 16000,
    },
    text: {
      id: 'gemini-flash-latest',
      strict: false,
      maxTokensParam: 'max_tokens',
      maxImages: 0,
      tokensPerImage: 0,
      tpm: 250000,
      maxOutput: 16000,
    },
    verified: false,
    note: 'Free tier on Flash models. Takes several images in one call. Limits shown in AI Studio.',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    keyEnv: ['OPENROUTER_API_KEY'],
    keyUrl: 'https://openrouter.ai/keys',
    baseUrl: (env) => env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: (env) => env.OPENROUTER_API_KEY,
    fallbackKey: (env) => env.OPENROUTER_API_KEY_FALLBACK,
    vision: {
      id: 'google/gemma-4-26b-a4b-it:free',
      strict: false,
      maxTokensParam: 'max_tokens',
      maxImages: 3,
      tokensPerImage: 1500,
      tpm: 60000,
      maxOutput: 8000,
    },
    text: {
      id: 'google/gemma-4-26b-a4b-it:free',
      strict: false,
      maxTokensParam: 'max_tokens',
      maxImages: 0,
      tokensPerImage: 0,
      tpm: 60000,
      maxOutput: 8000,
    },
    verified: false,
    note: 'Free models are limited to about 50 requests a day, and a busy model can be refused for a minute or two. Gemma 4 is pinned to Google AI Studio.',
  },
  cloudflare: {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    keyEnv: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
    keyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    baseUrl: (env) => `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID ?? ''}/ai/v1`,
    apiKey: (env) => env.CLOUDFLARE_API_TOKEN,
    fallbackKey: (env) => env.CLOUDFLARE_API_TOKEN_FALLBACK,
    vision: {
      id: '',
      strict: false,
      maxTokensParam: 'max_tokens',
      maxImages: 1,
      tokensPerImage: 1500,
      tpm: 60000,
      maxOutput: 4000,
    },
    text: {
      id: '',
      strict: false,
      maxTokensParam: 'max_tokens',
      maxImages: 0,
      tokensPerImage: 0,
      tpm: 60000,
      maxOutput: 4000,
    },
    verified: false,
    note: 'Free allowance of 10,000 neurons a day. Check the connection, then pick a model that reads images.',
  },
};

/**
 * Request fields a particular model needs on top of its provider's. OpenRouter routes a model to
 * whichever host it likes unless told otherwise; Gemma 4 is pinned to Google AI Studio, with no
 * fallback, so a failure there is reported instead of quietly sent to another host.
 */
const MODEL_ROUTES: Record<string, Record<string, unknown>> = {
  'openrouter:google/gemma-4-26b-a4b-it:free': {
    provider: { only: ['google-ai-studio'], allow_fallbacks: false },
  },
};

export function modelRoute(provider: ProviderId, modelId: string): Record<string, unknown> {
  return MODEL_ROUTES[`${provider}:${modelId}`] ?? {};
}

export function hasKeys(id: ProviderId, env: NodeJS.ProcessEnv = process.env): boolean {
  return PROVIDERS[id].keyEnv.every((name) => Boolean(env[name]?.trim()));
}

export function providerRuntime(id: ProviderId, env: NodeJS.ProcessEnv = process.env): ProviderRuntime | null {
  if (!hasKeys(id, env)) return null;
  const spec = PROVIDERS[id];
  const apiKey = spec.apiKey(env)!.trim();
  const fallback = spec.fallbackKey(env)?.trim();
  return { id, baseUrl: spec.baseUrl(env), apiKey, ...(fallback && fallback !== apiKey ? { fallbackKey: fallback } : {}) };
}

export interface ModelOverrides {
  vision?: string;
  text?: string;
}

export interface ProviderSetup {
  runtime: ProviderRuntime;
  label: string;
  vision: ModelSpec;
  text: ModelSpec;
}

/**
 * The providers an analysis may use, in the user's order. A provider is left out when its key is
 * missing or no vision model has been chosen for it.
 */
export function providerChain(
  order: ProviderId[],
  overrides: Partial<Record<ProviderId, ModelOverrides>> = {},
  env: NodeJS.ProcessEnv = process.env,
): ProviderSetup[] {
  const chain: ProviderSetup[] = [];
  for (const id of order) {
    const runtime = providerRuntime(id, env);
    if (!runtime) continue;
    const spec = PROVIDERS[id];
    const visionId = overrides[id]?.vision?.trim() || spec.vision.id;
    if (!visionId) continue;
    const textId = overrides[id]?.text?.trim() || spec.text.id || visionId;
    // An overridden model keeps the provider's limits but cannot be assumed to enforce schemas.
    const vision = {
      ...spec.vision,
      id: visionId,
      strict: spec.vision.strict && visionId === spec.vision.id,
      extraBody: { ...(visionId === spec.vision.id ? spec.vision.extraBody : undefined), ...modelRoute(id, visionId) },
    };
    const text = {
      ...spec.text,
      id: textId,
      strict: spec.text.strict && textId === spec.text.id,
      extraBody: { ...(textId === spec.text.id ? spec.text.extraBody : undefined), ...modelRoute(id, textId) },
    };
    chain.push({ runtime, label: spec.label, vision, text });
  }
  return chain;
}
