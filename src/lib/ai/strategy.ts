import type { SubjectMode } from './schema/display';
import type { Category } from '../library/categories';
import type { CollectionChoice } from '../library/collections';
import { snapTags } from '../library/vocabulary';
import type { Mode, Steer } from '../types';
import { estimateTokens, framesPerCall, planCall } from './budget';
import { chatJson, ProviderError, type ChatRequest, type ChatResult } from './client';
import type { Lens } from './prompts/lenses';
import { observePrompt } from './prompts/observe';
import { translatePrompt } from './prompts/translate';
import { waitBeforeCall, type RateInfo } from './ratelimit';
import type { ModelSpec, ProviderSetup } from './registry';
import type { Spec } from './schema/display';
import { buildSpec, mergeObservations, observationDigest } from './schema/expand';
import { dimensionsFor } from './schema/dimensions';
import {
  observationJsonSchema,
  parsePatterns,
  patternsJsonSchema,
  parseObservation,
  parseSlice,
  parseTranslation,
  shapeHint,
  sliceJsonSchema,
  translationJsonSchema,
  assembleSlices,
  type Patterns,
  type Scope,
  type SliceResult,
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
  /** A guided retry's focus and note; the focus is already in `lens`. */
  steer?: Steer | null;
  /** Changes the person wants from the reference: the translation applies them and the spec keeps them. */
  changes?: string;
  /** Image entries: the subject choice the prompt makes by default, kept on the spec. */
  subject?: { mode: SubjectMode; text?: string } | null;
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
  /** Learned per-minute output caps and recent output, shared between analyses. */
  outputs?: OutputBook;
  /** Tokens the provider adds to the prompt for the enforced schema (measured, not estimated). */
  schemaOverhead?: number;
  /** Told about every request sent, answered or refused, for the Usage page. */
  onCall?: (record: CallInfo) => void;
}

export interface CallInfo {
  at: number;
  provider: string;
  model: string;
  step: 'observe' | 'translate';
  tokensIn: number;
  tokensOut: number;
  ok: boolean;
  error: string | null;
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
  structure: { want: 3200, min: 1800, comfort: 0 },
  both: { want: 8200, min: 5600, comfort: 6800 },
};
const TRANSLATE_WANT = 4500;
const TRANSLATE_MIN = 2200;

const MARGIN_MS = 500;
const DEFAULT_BACKOFF_MS = 60_000;
/** A wait longer than this means a daily quota; try another provider instead. */
const MAX_WAIT_MS = 10 * 60_000;
const MAX_RATE_RETRIES = 3;
const TRANSIENT_RETRY_MS = 3000;

/**
 * Some free tiers cap output tokens per minute far below what one answer needs (Groq's qwen3.8 is
 * held to 1000). The cap is learned from the provider's own refusal, and answers are then asked for
 * in slices, each paced to fit: slower, but nothing is cut short.
 */
export interface OutputBook {
  caps: Map<string, number>;
  log: Map<string, { at: number; tokens: number }[]>;
}

class OutputCapLearned extends Error {
  constructor(public cap: number) {
    super(`output is capped at ${cap} tokens a minute`);
  }
}

/** Milliseconds until `requested` more output tokens fit under the per-minute cap. */
function outputWait(log: { at: number; tokens: number }[], requested: number, cap: number, now: number): number {
  const recent = log.filter((entry) => entry.at > now - 60_000).sort((a, b) => a.at - b.at);
  let used = recent.reduce((sum, entry) => sum + entry.tokens, 0);
  for (const entry of recent) {
    if (used + requested <= cap) return 0;
    used -= entry.tokens;
    if (used + requested <= cap) return Math.max(0, entry.at + 60_000 - now) + 1000;
  }
  return used + requested <= cap ? 0 : 61_000;
}

// Kept on globalThis so the worker and the Settings route read the same readings.
const globals = globalThis as { __inspiRates?: RateBook; __inspiOutputs?: OutputBook };
const sharedRates: RateBook = (globals.__inspiRates ??= new Map());
const sharedOutputs: OutputBook = (globals.__inspiOutputs ??= { caps: new Map(), log: new Map() });

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
        return `the request is larger than its per-minute allowance (${error.message})`;
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

/** Rough output tokens per item, used to pack slices under a per-minute output cap. */
const SLICE_WEIGHT = { patterns: 800, meta: 350, dimension: 55 };

/**
 * Splits the full observation into slices that each fit `cap` output tokens. No slice depends on
 * another, so they can run side by side on several keys. Dimensions are the small, divisible part,
 * so they fill whatever room the other slices leave.
 */
export function planSlices(mode: Mode, cap: number): Scope[] {
  const budget = Math.floor(cap * 0.9);
  const bins: { scope: Scope; weight: number }[] = [];
  const add = (scope: Scope, weight: number, fresh = false) => {
    const last = bins[bins.length - 1];
    if (!fresh && last && last.weight + weight <= budget) {
      Object.assign(last.scope, scope);
      last.weight += weight;
    } else {
      bins.push({ scope: { ...scope }, weight });
    }
  };
  if (mode === 'web') add({ patterns: true }, SLICE_WEIGHT.patterns);
  add({ meta: true }, SLICE_WEIGHT.meta);

  const pending = [...dimensionsFor(mode)];
  const take = (bin: { scope: Scope; weight: number }) => {
    const room = Math.floor((budget - bin.weight) / SLICE_WEIGHT.dimension);
    if (room <= 0 || pending.length === 0) return;
    const got = pending.splice(0, room);
    bin.scope.dims = [...(bin.scope.dims ?? []), ...got];
    bin.weight += got.length * SLICE_WEIGHT.dimension;
  };
  for (const bin of bins) take(bin);
  while (pending.length) {
    const bin = { scope: {} as Scope, weight: 0 };
    take(bin);
    bins.push(bin);
  }
  return bins.map((bin) => bin.scope);
}

function sliceLabel(scope: Scope): string {
  return scope.patterns ? 'Reading the patterns' : 'Measuring the design';
}

/** Reverse-engineers the frames with the first provider in the chain that manages it. */
export async function analyze(input: AnalyzeInput, deps: AnalyzeDeps): Promise<AnalyzeResult> {
  if (deps.chain.length === 0) {
    throw new AnalysisError('No AI provider is set up. Add an API key to .env and check Settings.', []);
  }
  const reasons: string[] = [];
  for (const setup of deps.chain) {
    try {
      try {
        return await runWith(setup, input, deps);
      } catch (error) {
        // The provider just revealed an output cap: the same analysis can be asked for in slices.
        if (!(error instanceof OutputCapLearned)) throw error;
        return await runWith(setup, input, deps);
      }
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
  const outputs = deps.outputs ?? sharedOutputs;
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
  // Parts of one analysis run side by side, one request per key at a time: a key is reserved from
  // the moment a call picks it (including any wait for its quota) until its answer is back.
  const busy = new Set<number>();
  let waiters: (() => void)[] = [];
  const wakeAll = () => {
    const woken = waiters;
    waiters = [];
    for (const wake of woken) wake();
  };
  const release = (index: number) => {
    busy.delete(index);
    wakeAll();
  };
  // Once one part fails, the others stop before sending anything more.
  let abandoned = false;
  async function together<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
    return Promise.all(
      tasks.map((task) =>
        task().catch((error: unknown) => {
          abandoned = true;
          wakeAll();
          throw error;
        }),
      ),
    );
  }
  const stopIfAbandoned = () => {
    if (abandoned) throw new Error('another part of this analysis failed');
  };

  /** One model call, holding off for quotas and retrying what is worth retrying. */
  async function call<T>(
    model: ModelSpec,
    request: Omit<ChatRequest<T>, 'provider' | 'model'>,
    needed: number,
    resume: string,
    step: CallInfo['step'] = 'observe',
  ): Promise<T> {
    const record = (ok: boolean, tokens: { input: number; output: number }, error: string | null = null) =>
      deps.onCall?.({ at: now(), provider: setup.runtime.id, model: model.id, step, tokensIn: tokens.input, tokensOut: tokens.output, ok, error });
    const rateKey = (index: number) => (index === 0 ? `${setup.runtime.id}:${model.id}` : `${setup.runtime.id}:${model.id}:key${index + 1}`);
    // An output cap is the model's free-tier limit, so a key without its own reading shares the first key's.
    const capOf = (index: number) => outputs.caps.get(rateKey(index)) ?? outputs.caps.get(rateKey(0));
    let transientRetried = false;
    let lastQuota = '';

    for (let attempt = 0; attempt < (MAX_RATE_RETRIES + 1) * keys.length; attempt++) {
      // Every usable key is serving another part of this analysis: wait for one to come free.
      let waited = false;
      while (!abandoned && keys.some((_, i) => !dead.has(i)) && keys.every((_, i) => dead.has(i) || busy.has(i))) {
        await new Promise<void>((resolve) => waiters.push(resolve));
        waited = true;
      }
      // A key comes free the moment the part holding it finishes, which may be a failure still on its
      // way up; let it land before deciding to send anything.
      if (waited) await new Promise((resolve) => setTimeout(resolve, 0));
      stopIfAbandoned();
      // The key that can go soonest.
      let best = -1;
      let bestWait = Infinity;
      for (let i = 0; i < keys.length; i++) {
        if (dead.has(i) || busy.has(i)) continue;
        const known = rates.get(rateKey(i));
        const fromHeaders = known ? Math.max(0, waitBeforeCall(known.info, needed) - (now() - known.at)) : 0;
        const cap = capOf(i);
        const pace = cap ? outputWait(outputs.log.get(rateKey(i)) ?? [], Math.min(request.maxTokens, cap), cap, now()) : 0;
        const wait = Math.max(fromHeaders, pace, (blockedUntil.get(i) ?? 0) - now());
        if (wait > MAX_WAIT_MS) {
          dead.add(i);
          lastQuota = about(i, `its quota is used up for about ${minutes(wait)}`);
        } else if (wait < bestWait) {
          best = i;
          bestWait = wait;
        }
      }
      if (best === -1) throw new Error(lastQuota || 'every key for it was rejected');

      busy.add(best);
      try {
        if (bestWait > 0) {
          report(`Waiting for ${setup.label} quota`, now() + bestWait);
          await sleep(bestWait);
          stopIfAbandoned();
          report(resume);
        }
        calls++;
        const cap = capOf(best);
        const maxTokens = cap ? Math.min(request.maxTokens, cap) : request.maxTokens;
        const result = await chat<T>({ ...request, maxTokens, provider: { ...setup.runtime, apiKey: keys[best] }, model });
        rates.set(rateKey(best), { info: result.rate, at: now() });
        if (cap) outputs.log.set(rateKey(best), [...(outputs.log.get(rateKey(best)) ?? []).filter((e) => e.at > now() - 60_000), { at: now(), tokens: result.usage.output }]);
        usage.input += result.usage.input;
        usage.output += result.usage.output;
        record(true, result.usage);
        return result.data;
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        record(false, { input: 0, output: 0 }, error.kind);
        if (Object.keys(error.rate).length) rates.set(rateKey(best), { info: error.rate, at: now() });

        if (error.kind === 'too_large') {
          // "…output tokens per minute (OTPM): Limit 1000, Requested 1842": a cap, not a delay.
          const limit = /output tokens per minute[^]*?Limit (\d+)/i.exec(error.message);
          const learned = limit ? Number(limit[1]) : 0;
          if (learned > 0 && request.maxTokens > learned && capOf(best) !== learned) {
            // The cap belongs to the model's free tier, so every key for it gets the same one.
            keys.forEach((_, i) => outputs.caps.set(rateKey(i), learned));
            throw new OutputCapLearned(learned);
          }
          throw error;
        }
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
      } finally {
        release(best);
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
      const json = patternsJsonSchema();
      return { name: 'patterns', json, shape: shapeHint(json), parse: (raw: unknown) => parsePatterns(raw) };
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
      steer: input.steer,
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

  // A web page needs its patterns read as well as its style measured. One answer holds both when
  // the allowance is large; otherwise they are two calls on the same frame, side by side if there
  // are two keys.
  let parts: Part[] = ['system'];
  if (input.mode === 'web') parts = planFor('both', promptFor(1, 'names', false, 'both'), 1) ? ['both'] : ['structure', 'system'];

  // Prefer the full rubric; fall back to dimension names when it would crowd out the answer.
  const dimensionPart: Part = parts.includes('both') ? 'both' : 'system';
  const roomWithFull = planFor(dimensionPart, promptFor(1, 'full', false, dimensionPart), 1);
  const rubric: 'full' | 'names' = !roomWithFull || roomWithFull.maxOutput < OBSERVE_SIZES[dimensionPart].comfort ? 'names' : 'full';

  // Every part must fit with the same frames, so the tightest part decides.
  const perCall = Math.min(
    ...parts.map((p) =>
      framesPerCall({ ...budget, promptTokens: tokensOf(promptFor(1, p === 'structure' ? 'names' : rubric, false, p)), minOutput: OBSERVE_SIZES[p].min }),
    ),
  );
  if (perCall === 0) throw new Error('its per-minute allowance is too small for one image');

  // A provider that caps output per minute gets the analysis in slices (see OutputBook).
  const outputCap = outputs.caps.get(`${setup.runtime.id}:${vision.id}`);
  const scopes = outputCap && outputCap < OBSERVE_SIZES.structure.min ? planSlices(input.mode, outputCap) : null;

  const observations: Observation[] = [];
  let done = 0;
  for (const group of chunk(input.frames, perCall)) {
    const base = readingText(done, group.length, input.frames.length, collage);

    if (scopes) {
      // Slices are independent: each goes out as soon as a key is free, several at once with two keys.
      let finished = 0;
      const results = await together(scopes.map((scope, index) => async () => {
        const label = `${sliceLabel(scope)} (${index + 1} of ${scopes.length})${input.frames.length > 1 ? `, ${base.toLowerCase()}` : ''}`;
        const json = sliceJsonSchema(input.mode, scope);
        const schema = { name: 'slice', json, shape: shapeHint(json), parse: (raw: unknown) => parseSlice(input.mode, raw, scope) };
        const result = await withTerseRetry(async (terse) => {
          const prompt = observePrompt({
            mode: input.mode,
            frames: group.length,
            collage,
            rubric: terse ? 'names' : 'full',
            lens: input.lens,
            previousSignature: input.previousSignature,
            steer: input.steer,
            terse,
            scope,
          });
          const plan = planCall({
            ...budget,
            modelMaxOutput: vision.maxOutput,
            promptTokens: tokensOf(prompt),
            images: group.length,
            wantOutput: outputCap!,
            minOutput: Math.min(outputCap!, 400),
          });
          if (!plan) throw new Error('the frames do not fit its per-minute allowance');
          const done = await call<SliceResult>(
            vision,
            { system: prompt.system, user: prompt.user, images: group.map((f) => f.dataUrl), schema, maxTokens: plan.maxOutput, temperature: input.temperature },
            plan.inputTokens + plan.maxOutput,
            label,
          );
          finished++;
          if (finished < scopes.length) report(`Reading the image: ${finished} of ${scopes.length} parts done`);
          return done;
        });
        return result;
      }));
      observations.push(assembleSlices(results));
      done += group.length;
      continue;
    }

    const answers = await together(parts.map((part) => async () => {
      const label =
        parts.length === 1
          ? base
          : part === 'structure'
            ? input.frames.length === 1 ? 'Reading the patterns' : `${base}: patterns`
            : input.frames.length === 1 ? 'Measuring the design' : `${base}: design`;
      report(label);
      const schema = schemaFor(part);
      const result = await withTerseRetry(async (terse) => {
        const prompt = promptFor(group.length, terse || part === 'structure' ? 'names' : rubric, terse, part);
        const plan = planFor(part, prompt, group.length);
        if (!plan) throw new Error('the frames do not fit its per-minute allowance');
        return call<Patterns | Observation>(
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
      return { part, result };
    }));
    const patterns = answers.find((a) => a.part === 'structure')?.result as Patterns | undefined;
    const measured = answers.find((a) => a.part !== 'structure')!.result as Observation;
    observations.push({ ...measured, ...(patterns ? { patterns } : {}) });
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
    const prompt = translatePrompt({ mode: input.mode, digest, knownTags: input.knownTags, collections: offered, terse, steer: input.steer, changes: input.changes });
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
      'translate',
    );
  });

  const identity = input.identity ?? {
    name: translation.name,
    category: translation.category,
    // Onto the premade vocabulary, keeping only a couple of genuinely new tags.
    tags: snapTags(translation.tags, { known: input.knownTags }),
  };
  const spec = buildSpec({ mode: input.mode, observation, translation, identity, changes: input.changes, subject: input.subject });

  return { spec, identity, note: translation.note, collections: input.identity ? [] : translation.collections, provider: setup.label, model: vision.id, usage, calls };
}
