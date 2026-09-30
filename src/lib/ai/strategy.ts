import type { Category } from '../library/categories';
import type { CollectionChoice } from '../library/collections';
import { snapTags } from '../library/vocabulary';
import type { Mode } from '../types';
import { estimateTokens, framesPerCall, planCall } from './budget';
import { chatJson, ProviderError, type ChatRequest, type ChatResult } from './client';
import type { Lens } from './prompts/lenses';
import { observePrompt } from './prompts/observe';
import { translatePrompt } from './prompts/translate';
import { waitBeforeCall, type RateInfo } from './ratelimit';
import type { ModelSpec, ProviderSetup } from './registry';
import type { Spec } from './schema/display';
import { buildSpec, mergeObservations, observationDigest } from './schema/expand';
import {
  blueprintJsonSchema,
  observationJsonSchema,
  parseBlueprint,
  parseObservation,
  parseTranslation,
  shapeHint,
  translationJsonSchema,
  type Blueprint,
  type Observation,
  type Translation,
} from './schema/wire';

export interface Frame {
  dataUrl: string;
  /** How many source images this frame holds; more than one means a collage. */
  images: number;
}

export interface Identity {
  name: string;
  category: Category;
  tags: string[];
}

export interface AnalyzeInput {
  mode: Mode;
  frames: Frame[];
  lens: Lens;
  knownTags: string[];
  /** Collections the entry may be filed into (seed list plus the user's own). */
  collections?: CollectionChoice[];
  temperature: number;
  /** Set on a retry: the entry keeps its name, category and tags. */
  identity?: Identity;
  previousSignature?: string[];
}

export interface Progress {
  text: string;
  /** Epoch ms the analysis is paused until, when waiting on a quota. */
  waitUntil: number | null;
}

export type RateBook = Map<string, { info: RateInfo; at: number }>;

export interface AnalyzeDeps {
  chain: ProviderSetup[];
  onProgress?: (progress: Progress) => void;
  chat?: <T>(req: ChatRequest<T>) => Promise<ChatResult<T>>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Last known rate-limit state per provider and model, shared between analyses. */
  rates?: RateBook;
  /** Tokens the provider adds to the prompt for the enforced schema (measured, not estimated). */
  schemaOverhead?: number;
}

export interface AnalyzeResult {
  spec: Spec;
  identity: Identity;
  note: string;
  /** Names from the offered collections; empty on a retry, which keeps the entry where it is. */
  collections: string[];
  provider: string;
  model: string;
  usage: { input: number; output: number };
  calls: number;
}

export class AnalysisError extends Error {
  constructor(
    message: string,
    public reasons: string[],
  ) {
    super(message);
    this.name = 'AnalysisError';
  }
}

type Part = 'structure' | 'system' | 'both';

/** Output tokens wanted and the least worth having, per kind of observe call. */
const OBSERVE_SIZES: Record<Part, { want: number; min: number; comfort: number }> = {
  system: { want: 5000, min: 2800, comfort: 3400 },
  structure: { want: 4500, min: 2400, comfort: 0 },
  both: { want: 9500, min: 6500, comfort: 7800 },
};
const TRANSLATE_WANT = 4500;
const TRANSLATE_MIN = 2200;

const MARGIN_MS = 500;
const DEFAULT_BACKOFF_MS = 60_000;
/** A wait longer than this means a daily quota; try another provider instead. */
const MAX_WAIT_MS = 10 * 60_000;
const MAX_RATE_RETRIES = 3;
const TRANSIENT_RETRY_MS = 3000;

// Kept on globalThis so the worker and the Settings route read the same readings.
const globals = globalThis as { __inspiRates?: RateBook };
const sharedRates: RateBook = (globals.__inspiRates ??= new Map());

/** The latest rate-limit reading per 'provider:model', for the Settings quota meter. */
export function knownRates(): RateBook {
  return sharedRates;
}

function minutes(ms: number): string {
  const total = Math.ceil(ms / 60_000);
  return total >= 60 ? `${Math.round(total / 60)} h` : `${total} min`;
}

function explain(error: unknown): string {
  if (error instanceof ProviderError) {
    switch (error.kind) {
      case 'auth':
        return 'the API key was rejected';
      case 'rate_limit':
        return `the rate limit kept being hit (${error.message})`;
      case 'too_large':
        return 'the request is larger than its per-minute allowance';
      case 'truncated':
        return 'the answer did not fit in its output allowance';
      case 'invalid_output':
        return 'it returned JSON that does not fit the expected shape';
      case 'network':
        return 'it could not be reached';
      case 'server':
        return `it had a server error (${error.message})`;
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function readingText(done: number, size: number, total: number, collage: boolean): string {
  if (total === 1) return collage ? 'Reading the contact sheet' : 'Reading the image';
  if (size === total) return `Reading ${total} frames`;
  if (size === 1) return `Reading frame ${done + 1} of ${total}`;
  return `Reading frames ${done + 1}–${done + size} of ${total}`;
}

/** Reverse-engineers the frames with the first provider in the chain that manages it. */
export async function analyze(input: AnalyzeInput, deps: AnalyzeDeps): Promise<AnalyzeResult> {
  if (deps.chain.length === 0) {
    throw new AnalysisError('No AI provider is set up. Add an API key to .env and check Settings.', []);
  }
  const reasons: string[] = [];
  for (const setup of deps.chain) {
    try {
      return await runWith(setup, input, deps);
    } catch (error) {
      reasons.push(`${setup.label}: ${explain(error)}`);
    }
  }
  throw new AnalysisError(`The analysis could not be completed. ${reasons.join('. ')}.`, reasons);
}

async function runWith(setup: ProviderSetup, input: AnalyzeInput, deps: AnalyzeDeps): Promise<AnalyzeResult> {
  const chat = deps.chat ?? chatJson;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const rates = deps.rates ?? sharedRates;
  const overhead = deps.schemaOverhead ?? 0;
  const report = (text: string, waitUntil: number | null = null) => deps.onProgress?.({ text, waitUntil });

  const usage = { input: 0, output: 0 };
  let calls = 0;

  // The same provider's second key, if there is one, takes over while the first is waiting or out of quota.
  const keys = [setup.runtime.apiKey, ...(setup.runtime.fallbackKey ? [setup.runtime.fallbackKey] : [])];
  const dead = new Set<number>();
  /** When each key may be used again after a 429 that named a delay. */
  const blockedUntil = new Map<number, number>();
  const about = (index: number, what: string) => (keys.length > 1 ? `${index === 0 ? 'first' : 'second'} key: ${what}` : what);

  /** One model call, holding off for quotas and retrying what is worth retrying. */
  async function call<T>(model: ModelSpec, request: Omit<ChatRequest<T>, 'provider' | 'model'>, needed: number, resume: string): Promise<T> {
    const rateKey = (index: number) => (index === 0 ? `${setup.runtime.id}:${model.id}` : `${setup.runtime.id}:${model.id}:key${index + 1}`);
    let transientRetried = false;
    let lastQuota = '';

    for (let attempt = 0; attempt < (MAX_RATE_RETRIES + 1) * keys.length; attempt++) {
      // The key that can go soonest.
      let best = -1;
      let bestWait = Infinity;
      for (let i = 0; i < keys.length; i++) {
        if (dead.has(i)) continue;
        const known = rates.get(rateKey(i));
        const fromHeaders = known ? Math.max(0, waitBeforeCall(known.info, needed) - (now() - known.at)) : 0;
        const wait = Math.max(fromHeaders, (blockedUntil.get(i) ?? 0) - now());
        if (wait > MAX_WAIT_MS) {
          dead.add(i);
          lastQuota = about(i, `its quota is used up for about ${minutes(wait)}`);
        } else if (wait < bestWait) {
          best = i;
          bestWait = wait;
        }
      }
      if (best === -1) throw new Error(lastQuota || 'every key for it was rejected');

      if (bestWait > 0) {
        report(`Waiting for ${setup.label} quota`, now() + bestWait);
        await sleep(bestWait);
        report(resume);
      }

      try {
        calls++;
        const result = await chat<T>({ ...request, provider: { ...setup.runtime, apiKey: keys[best] }, model });
        rates.set(rateKey(best), { info: result.rate, at: now() });
        usage.input += result.usage.input;
        usage.output += result.usage.output;
        return result.data;
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        if (Object.keys(error.rate).length) rates.set(rateKey(best), { info: error.rate, at: now() });

        if (error.kind === 'auth' && keys.length > 1) {
          // This key is rejected; the other one may still work.
          dead.add(best);
          lastQuota = about(best, 'the API key was rejected');
          if (dead.size < keys.length) continue;
          throw error;
        }
        if (error.kind === 'rate_limit') {
          const backoff = (error.rate.retryAfterMs ?? error.rate.resetTokensMs ?? DEFAULT_BACKOFF_MS) + MARGIN_MS;
          if (backoff > MAX_WAIT_MS) {
            dead.add(best);
            lastQuota = about(best, `its quota is used up for about ${minutes(backoff)}`);
            if (dead.size < keys.length) continue;
            throw new Error(lastQuota);
          }
          blockedUntil.set(best, now() + backoff);
          if (attempt === (MAX_RATE_RETRIES + 1) * keys.length - 1) throw error;
          continue;
        }
        if ((error.kind === 'server' || error.kind === 'network') && !transientRetried) {
          transientRetried = true;
          await sleep(TRANSIENT_RETRY_MS);
          continue;
        }
        throw error;
      }
    }
    throw new ProviderError('rate_limit', 'rate limit');
  }

  /** Runs `attempt(false)`, and once more tersely if the answer did not fit. */
  async function withTerseRetry<T>(attempt: (terse: boolean) => Promise<T>): Promise<T> {
    try {
      return await attempt(false);
    } catch (error) {
      if (error instanceof ProviderError && (error.kind === 'truncated' || error.kind === 'too_large')) {
        return attempt(true);
      }
      throw error;
    }
  }

  // ---- Pass 1: observe (vision) ----
  const collage = input.frames.some((f) => f.images > 1);
  const schemaFor = (part: Part) => {
    if (part === 'structure') {
      const json = blueprintJsonSchema();
      return { name: 'blueprint', json, shape: shapeHint(json), parse: (raw: unknown) => parseBlueprint(raw) };
    }
    const json = observationJsonSchema(input.mode, part === 'both');
    return { name: 'observation', json, shape: shapeHint(json), parse: (raw: unknown) => parseObservation(input.mode, raw, part === 'both') };
  };

  const promptFor = (frames: number, rubric: 'full' | 'names', terse: boolean, part: Part) =>
    observePrompt({
      mode: input.mode,
      frames,
      collage,
      rubric,
      lens: input.lens,
      previousSignature: input.previousSignature,
      terse,
      part,
    });
  const tokensOf = (p: { system: string; user: string }) => estimateTokens(p.system + p.user) + overhead;

  const vision = setup.vision;
  const budget = { tpm: vision.tpm, tokensPerImage: vision.tokensPerImage, maxImages: vision.maxImages };
  const planFor = (part: Part, prompt: { system: string; user: string }, images: number) =>
    planCall({
      ...budget,
      modelMaxOutput: vision.maxOutput,
      promptTokens: tokensOf(prompt),
      images,
      wantOutput: OBSERVE_SIZES[part].want,
      minOutput: OBSERVE_SIZES[part].min,
    });

  // A web page needs its structure transcribed as well as its style measured. One answer holds
  // both when the allowance is large; otherwise they are two calls on the same frame.
  let parts: Part[] = ['system'];
  if (input.mode === 'web') parts = planFor('both', promptFor(1, 'names', false, 'both'), 1) ? ['both'] : ['structure', 'system'];

  // Prefer the full rubric; fall back to dimension names when it would crowd out the answer.
  const dimensionPart: Part = parts.includes('both') ? 'both' : 'system';
  const roomWithFull = planFor(dimensionPart, promptFor(1, 'full', false, dimensionPart), 1);
  const rubric: 'full' | 'names' = !roomWithFull || roomWithFull.maxOutput < OBSERVE_SIZES[dimensionPart].comfort ? 'names' : 'full';

  const perCall = framesPerCall({
    ...budget,
    promptTokens: Math.max(...parts.map((p) => tokensOf(promptFor(1, p === 'structure' ? 'names' : rubric, false, p)))),
    minOutput: Math.min(...parts.map((p) => OBSERVE_SIZES[p].min)),
  });
  if (perCall === 0) throw new Error('its per-minute allowance is too small for one image');

  const observations: Observation[] = [];
  let done = 0;
  for (const group of chunk(input.frames, perCall)) {
    const base = readingText(done, group.length, input.frames.length, collage);
    let blueprint: Blueprint | undefined;
    let measured: Observation | undefined;

    for (const part of parts) {
      const label =
        parts.length === 1
          ? base
          : part === 'structure'
            ? input.frames.length === 1 ? 'Reading the layout' : `${base}: layout`
            : input.frames.length === 1 ? 'Measuring the design' : `${base}: design`;
      report(label);
      const schema = schemaFor(part);
      const result = await withTerseRetry(async (terse) => {
        const prompt = promptFor(group.length, terse || part === 'structure' ? 'names' : rubric, terse, part);
        const plan = planFor(part, prompt, group.length);
        if (!plan) throw new Error('the frames do not fit its per-minute allowance');
        return call<Blueprint | Observation>(
          vision,
          {
            system: prompt.system,
            user: prompt.user,
            images: group.map((f) => f.dataUrl),
            schema,
            maxTokens: plan.maxOutput,
            temperature: input.temperature,
          },
          plan.inputTokens + plan.maxOutput,
          label,
        );
      });
      if (part === 'structure') blueprint = result as Blueprint;
      else measured = result as Observation;
    }

    observations.push({ ...measured!, ...(blueprint ? { blueprint } : {}) });
    done += group.length;
  }
  const observation = mergeObservations(observations);

  // ---- Pass 2: translate (text) ----
  const writing = input.mode === 'web' ? 'Writing the build spec' : 'Writing the style prompt';
  report(writing);

  const offered = input.collections ?? [];
  const offeredNames = offered.map((c) => c.name);
  const translateJson = translationJsonSchema(input.mode, offeredNames);
  const translateSchema = {
    name: 'translation',
    json: translateJson,
    shape: shapeHint(translateJson),
    parse: (raw: unknown) => parseTranslation(input.mode, raw, offeredNames),
  };
  const digest = observationDigest(observation, input.mode);
  const text = setup.text;

  const translation = await withTerseRetry(async (terse) => {
    const prompt = translatePrompt({ mode: input.mode, digest, knownTags: input.knownTags, collections: offered, terse });
    const plan = planCall({
      tpm: text.tpm,
      modelMaxOutput: text.maxOutput,
      tokensPerImage: 0,
      promptTokens: tokensOf(prompt),
      images: 0,
      wantOutput: TRANSLATE_WANT,
      minOutput: TRANSLATE_MIN,
    });
    if (!plan) throw new Error('the observations do not fit its per-minute allowance');
    return call<Translation>(
      text,
      {
        system: prompt.system,
        user: prompt.user,
        schema: translateSchema,
        maxTokens: plan.maxOutput,
        temperature: input.temperature,
      },
      plan.inputTokens + plan.maxOutput,
      writing,
    );
  });

  const identity = input.identity ?? {
    name: translation.name,
    category: translation.category,
    // Onto the premade vocabulary, keeping only a couple of genuinely new tags.
    tags: snapTags(translation.tags, { known: input.knownTags }),
  };
  const spec = buildSpec({ mode: input.mode, observation, translation, identity });

  return { spec, identity, note: translation.note, collections: input.identity ? [] : translation.collections, provider: setup.label, model: vision.id, usage, calls };
}
