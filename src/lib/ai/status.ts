import { healthFrom } from '../imagine/types';
import type { Settings } from '../settings';
import type { ProviderId } from './client';
import type { RateInfo } from './ratelimit';
import { hasKeys, PROVIDERS, PROVIDER_IDS, providerRuntime } from './registry';
import { knownRates } from './strategy';

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  note: string;
  keyEnv: string[];
  keyUrl: string;
  hasKey: boolean;
  /** A second key for the same provider is set, used when the first is out of quota. */
  hasFallbackKey: boolean;
  /** A second key is set but is the same key as the first, so it adds nothing. */
  duplicateFallbackKey: boolean;
  /** False until the built-in model ids and limits were checked against a live key. */
  verified: boolean;
  visionModel: string;
  textModel: string;
  defaultVision: string;
  defaultText: string;
  /** Ready to analyse: has a key and a vision model. */
  usable: boolean;
  tokensPerMinute: number;
  /** Most recent reading from the provider's rate-limit headers, if any call was made this session. */
  rate: (RateInfo & { at: number }) | null;
}

/** What Settings shows for each provider. Never includes key values. */
export function providerStatuses(settings: Settings, env: NodeJS.ProcessEnv = process.env): ProviderStatus[] {
  const rates = knownRates();
  return settings.order.map((id) => {
    const spec = PROVIDERS[id];
    const visionModel = settings.models[id]?.vision || spec.vision.id;
    const textModel = settings.models[id]?.text || spec.text.id || visionModel;
    const reading = rates.get(`${id}:${visionModel}`);
    const keyed = hasKeys(id, env);
    return {
      id,
      label: spec.label,
      note: spec.note,
      keyEnv: spec.keyEnv,
      keyUrl: spec.keyUrl,
      hasKey: keyed,
      hasFallbackKey: Boolean(providerRuntime(id, env)?.fallbackKey),
      duplicateFallbackKey: Boolean(spec.fallbackKey(env)?.trim()) && spec.fallbackKey(env)?.trim() === spec.apiKey(env)?.trim(),
      verified: spec.verified,
      visionModel,
      textModel,
      defaultVision: spec.vision.id,
      defaultText: spec.text.id,
      usable: keyed && Boolean(visionModel),
      tokensPerMinute: spec.vision.tpm,
      rate: reading ? { ...reading.info, at: reading.at } : null,
    };
  });
}

export interface ListedModel {
  id: string;
  vision: boolean | null;
  free: boolean | null;
  /** Pollinations measures how its models are doing; other providers leave this out. */
  health?: 'healthy' | 'degraded' | 'unknown';
  successRate?: number | null;
}

export interface ModelListing {
  ok: boolean;
  models: ListedModel[];
  message: string;
}

/**
 * Providers that do not say which models read images get a hint from the model's name: the
 * gpt-oss and allam families are text-only, so offering them for images only produces errors.
 */
const TEXT_ONLY = /gpt-oss|allam|llama-3|compound/i;
const READS_IMAGES = /qwen3\.[5-9]|llama-4|vision|(?:^|[^a-z])vl(?:[^a-z]|$)|-vl-|scout|maverick|gemma-[34]|pixtral|gemini/i;

/**
 * Models that cannot do this job: speech, transcription, safety classifiers, embeddings, translation
 * and code-apply models, routers that pick some other model, and batch-only variants.
 */
const NOT_CHAT =
  /whisper|orpheus|voxtral|audio|guard|content-safety|-tts|tts-|embed|rerank|hy-mt|morph\/|relace\/|router|pareto|bodybuilder|fusion|:batch$/i;
const NOT_A_MODEL = /^openrouter\/|^~/;
/** Prompt plus answer need about 8K tokens; a smaller window cannot hold one call. */
const MIN_CONTEXT = 16_000;
/** Cloudflare says what a model is for; only these can answer with text. */
const CHAT_TASKS = /text generation|image-to-text/i;

type RawModel = {
  id?: string;
  name?: string;
  context_length?: number;
  context_window?: number;
  input_modalities?: string[];
  output_modalities?: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
  task?: { name?: string };
  /** Pollinations: only paid Pollen can buy this model. */
  paid_only?: boolean | null;
  health?: { status?: string; success_rate?: number | null } | null;
};

/** Turns a provider's model list into the chat models that can take part in an analysis. */
export function usableModels(raw: RawModel[]): ListedModel[] {
  const models: ListedModel[] = [];
  for (const m of raw) {
    // OpenRouter's `:free` ids are refused when sent; the plain id reaches the same free model.
    const id = (m.id ?? m.name ?? '').replace(/^models\//, '').replace(/:free$/, '');
    if (!id || NOT_CHAT.test(id) || NOT_A_MODEL.test(id)) continue;
    // Free Pollen cannot pay for these; they are never offered.
    if (m.paid_only === true) continue;
    const inputs = m.architecture?.input_modalities ?? m.input_modalities;
    const outputs = m.architecture?.output_modalities ?? m.output_modalities;
    // Image, audio and speech generators answer with something other than text.
    if (outputs && (!outputs.includes('text') || outputs.some((kind) => kind !== 'text'))) continue;
    const task = m.task?.name;
    if (task && !CHAT_TASKS.test(task)) continue;
    const context = m.context_length ?? m.context_window;
    if (context && context < MIN_CONTEXT) continue;
    models.push({
      id,
      vision: inputs
        ? inputs.includes('image')
        : task && /image-to-text/i.test(task)
          ? true
          : READS_IMAGES.test(id)
            ? true
            : TEXT_ONLY.test(id)
              ? false
              : null,
      free:
        'paid_only' in m
          ? true
          : m.pricing
            ? Number(m.pricing.prompt) === 0 && Number(m.pricing.completion ?? 0) === 0
            : null,
      ...(m.health
        ? {
            health: healthFrom(m.health.status, m.health.success_rate),
            successRate: typeof m.health.success_rate === 'number' ? Math.round(m.health.success_rate) : null,
          }
        : {}),
    });
  }
  // A model listed both paid and `:free` becomes one entry, free if either variant is.
  const byId = new Map<string, ListedModel>();
  for (const m of models) {
    const seen = byId.get(m.id);
    byId.set(m.id, seen ? { ...seen, free: seen.free === true || m.free === true ? true : seen.free ?? m.free } : m);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Providers wrap their lists differently: OpenAI-style `{ data }`, Cloudflare `{ result }`, Pollinations a bare array. */
export function modelsFromPayload(payload: unknown): RawModel[] {
  if (Array.isArray(payload)) return payload as RawModel[];
  const wrapped = payload as { data?: RawModel[]; result?: RawModel[] } | null;
  return wrapped?.data ?? wrapped?.result ?? [];
}

/** Where a provider lists its models. Pollinations' text catalogue says which ones free Pollen can pay for. */
export function modelListUrl(id: ProviderId, baseUrl: string, env: NodeJS.ProcessEnv = process.env): string {
  if (id === 'cloudflare') return `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/models/search?per_page=200`;
  if (id === 'pollinations') return `${baseUrl.replace(/\/v1\/?$/, '')}/text/models?reliability=all`;
  return `${baseUrl}/models`;
}

/** Asks a provider which models the key can use. Costs no tokens, so it doubles as a connection test. */
export async function listModels(id: ProviderId, env: NodeJS.ProcessEnv = process.env): Promise<ModelListing> {
  const runtime = providerRuntime(id, env);
  const spec = PROVIDERS[id];
  if (!runtime) {
    return { ok: false, models: [], message: `Add ${spec.keyEnv.join(' and ')} to .env and restart the server.` };
  }

  const url = modelListUrl(id, runtime.baseUrl, env);

  let response: Response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${runtime.apiKey}` }, signal: AbortSignal.timeout(15_000) });
  } catch {
    return { ok: false, models: [], message: `${spec.label} could not be reached.` };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, models: [], message: `${spec.label} rejected the key. Create a new one at ${spec.keyUrl}.` };
  }
  if (!response.ok) {
    return { ok: false, models: [], message: `${spec.label} answered with status ${response.status}.` };
  }

  const models = usableModels(modelsFromPayload(await response.json().catch(() => null)));

  return { ok: true, models, message: `${spec.label} is connected: ${models.length} models available.` };
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as string[]).includes(value);
}
