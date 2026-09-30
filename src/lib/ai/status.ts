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

export interface ModelListing {
  ok: boolean;
  models: { id: string; vision: boolean | null; free: boolean | null }[];
  message: string;
}

/**
 * Providers that do not say which models read images (Groq) get a hint from the model's name:
 * the gpt-oss and allam families are text-only, so offering them for images only produces errors.
 */
const TEXT_ONLY = /gpt-oss|allam|llama-3|llama-guard|compound/i;
const READS_IMAGES = /qwen3\.[5-9]|llama-4|vision|(?:^|[^a-z])vl(?:[^a-z]|$)|-vl-|scout|maverick|gemma-[34]|pixtral|gemini/i;

const NOT_CHAT = /whisper|orpheus|prompt-guard|safeguard|content-safety|-tts|tts-|embed|rerank/i;

/** Asks a provider which models the key can use. Costs no tokens, so it doubles as a connection test. */
export async function listModels(id: ProviderId, env: NodeJS.ProcessEnv = process.env): Promise<ModelListing> {
  const runtime = providerRuntime(id, env);
  const spec = PROVIDERS[id];
  if (!runtime) {
    return { ok: false, models: [], message: `Add ${spec.keyEnv.join(' and ')} to .env and restart the server.` };
  }

  const url =
    id === 'cloudflare'
      ? `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/models/search?per_page=200`
      : `${runtime.baseUrl}/models`;

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

  type Raw = {
    id?: string;
    name?: string;
    architecture?: { input_modalities?: string[]; output_modalities?: string[] };
    pricing?: { prompt?: string };
    task?: { name?: string };
  };
  const payload = (await response.json().catch(() => null)) as { data?: Raw[]; result?: Raw[] } | null;
  const raw = payload?.data ?? payload?.result ?? [];

  const models = raw
    // Speech, safety and audio/image generators cannot do this job, so they are not offered.
    .filter((m) => !m.architecture?.output_modalities || m.architecture.output_modalities.includes('text'))
    .filter((m) => !NOT_CHAT.test(m.id ?? m.name ?? ''))
    .map((m) => {
      const modelId = (m.id ?? m.name ?? '').replace(/^models\//, '');
      const modalities = m.architecture?.input_modalities;
      const task = m.task?.name?.toLowerCase();
      return {
        id: modelId,
        vision: modalities
          ? modalities.includes('image')
          : task
            ? task.includes('image')
            : TEXT_ONLY.test(modelId)
              ? false
              : READS_IMAGES.test(modelId)
                ? true
                : null,
        free: m.pricing ? Number(m.pricing.prompt) === 0 : null,
      };
    })
    .filter((m) => m.id)
    .sort((a, b) => a.id.localeCompare(b.id));

  return { ok: true, models, message: `${spec.label} is connected: ${models.length} models available.` };
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as string[]).includes(value);
}
