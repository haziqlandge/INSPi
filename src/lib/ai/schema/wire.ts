import { z } from 'zod';
import { CATEGORIES, coerceCategory, type Category } from '../../library/categories';
import { pickCollections } from '../../library/collections';
import { normalizeTags } from '../../library/tags';
import type { Mode } from '../../types';
import { dimensionsFor } from './dimensions';

/** One measured finding, in the short-key form the vision model emits to save tokens. */
export interface WireFinding {
  /** value */
  v: string;
  /** evidence */
  e: string;
  /** location */
  l: string;
  /** magnitude */
  m: string;
  /** confidence, 0–1 */
  c: number;
}

export interface PaletteColor {
  hex: string;
  role: string;
  share: number;
}

/** One band of a page: where it sits, how it is laid out, what is in it and how it is dressed. */
export interface BlueprintSection {
  name: string;
  /** Position and size, in px on the assumed page width. */
  box: string;
  layout: string;
  /** Every visible string, verbatim and in reading order, with each element's size, weight and colour. */
  content: string;
  style: string;
}

/** A repeated or illustrated piece (icons, decorations, mock-ups) described so it can be drawn again. */
export interface BlueprintAsset {
  name: string;
  look: string;
  placement: string;
}

/** The concrete page, as opposed to the abstract design system: what to build and where. */
export interface Blueprint {
  canvas: string;
  sections: BlueprintSection[];
  assets: BlueprintAsset[];
}

export interface Observation {
  gist: string;
  keywords: string[];
  signature: string[];
  palette: PaletteColor[];
  d: Record<string, WireFinding>;
  /** Web mode only. */
  blueprint?: Blueprint;
}

export interface TypeTokens {
  display: string;
  text: string;
  mono: string;
  scale: string;
  weights: string;
  tracking: string;
  leading: string;
}

export interface WebTokens {
  colors: { role: string; hex: string }[];
  type: TypeTokens;
  spacing: string;
  radius: string;
  border: string;
  shadow: string;
  motion: string;
}

interface TranslationBase {
  name: string;
  category: Category;
  tags: string[];
  note: string;
  /** Names of the collections the entry belongs in, chosen from the list offered. */
  collections: string[];
}

export interface WebTranslation extends TranslationBase {
  web: Record<string, string>;
  tokens: WebTokens;
  build: string[];
  avoid: string[];
}

export interface ImageTranslation extends TranslationBase {
  gen: Record<string, string>;
  prompt: string;
  negative: string[];
  params: { aspect_ratio: string; medium: string; notes: string };
}

export type Translation = WebTranslation | ImageTranslation;

export type Parsed<T> = { ok: true; data: T } | { ok: false; issues: string[] };

// ---------- JSON Schema (what the provider enforces) ----------

type JsonSchema = Record<string, unknown>;

const str: JsonSchema = { type: 'string' };
const num: JsonSchema = { type: 'number' };
const strings: JsonSchema = { type: 'array', items: str };

/** Strict mode: every key required, no extras. */
function obj(properties: Record<string, JsonSchema>): JsonSchema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function keyed(keys: readonly string[], value: JsonSchema): JsonSchema {
  return obj(Object.fromEntries(keys.map((k) => [k, value])));
}

const blueprintSchema = obj({
  canvas: str,
  sections: { type: 'array', items: obj({ name: str, box: str, layout: str, content: str, style: str }) },
  assets: { type: 'array', items: obj({ name: str, look: str, placement: str }) },
});

/** The page-structure half of a web observation, asked for on its own when the budget is small. */
export function blueprintJsonSchema(): JsonSchema {
  return obj({ blueprint: blueprintSchema });
}

/** The measured-dimensions half; `includeBlueprint` asks for the page structure in the same answer. */
export function observationJsonSchema(mode: Mode, includeBlueprint = false): JsonSchema {
  const finding = obj({ v: str, e: str, l: str, m: str, c: num });
  return obj({
    ...(includeBlueprint ? { blueprint: blueprintSchema } : {}),
    gist: str,
    keywords: strings,
    signature: strings,
    palette: { type: 'array', items: obj({ hex: str, role: str, share: num }) },
    d: keyed(dimensionsFor(mode), finding),
  });
}

export function translationJsonSchema(mode: Mode, collectionNames: readonly string[] = []): JsonSchema {
  const base = {
    name: str,
    category: { type: 'string', enum: [...CATEGORIES] },
    tags: strings,
    collections: { type: 'array', items: collectionNames.length ? { type: 'string', enum: [...collectionNames] } : str },
    note: str,
  };
  if (mode === 'web') {
    return obj({
      ...base,
      web: keyed(dimensionsFor('web'), str),
      tokens: obj({
        colors: { type: 'array', items: obj({ role: str, hex: str }) },
        type: obj({ display: str, text: str, mono: str, scale: str, weights: str, tracking: str, leading: str }),
        spacing: str,
        radius: str,
        border: str,
        shadow: str,
        motion: str,
      }),
      build: strings,
      avoid: strings,
    });
  }
  return obj({
    ...base,
    gen: keyed(dimensionsFor('image'), str),
    prompt: str,
    negative: strings,
    params: obj({ aspect_ratio: str, medium: str, notes: str }),
  });
}

/** A one-line skeleton for models that only support plain JSON mode. */
export function shapeHint(schema: JsonSchema): string {
  const walk = (s: JsonSchema): string => {
    if (s.type === 'object') {
      const props = s.properties as Record<string, JsonSchema>;
      return `{${Object.entries(props).map(([k, v]) => `"${k}": ${walk(v)}`).join(', ')}}`;
    }
    if (s.type === 'array') return `[${walk(s.items as JsonSchema)}]`;
    if (Array.isArray(s.enum)) return 'one of the listed categories';
    return String(s.type);
  };
  return walk(schema);
}

// ---------- Validation (what we accept back) ----------

const text = z.preprocess((v) => (typeof v === 'number' ? String(v) : v), z.string());

/** Models sometimes answer 85 instead of 0.85. */
const confidence = z.preprocess((v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return v;
  const scaled = n > 1 && n <= 100 ? n / 100 : n;
  return Math.min(1, Math.max(0, scaled));
}, z.number());

const share = z.preprocess((v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return v;
  const scaled = n > 1 && n <= 100 ? n / 100 : n;
  return Math.round(Math.min(1, Math.max(0, scaled)) * 100) / 100;
}, z.number());

const hex = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const bare = v.trim().replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{3}([0-9A-F]{3})?$/.test(bare) ? `#${bare}` : v.trim();
}, z.string());

const findingZ = z.object({ v: text, e: text, l: text, m: text, c: confidence });
const stringList = z.array(text);

function keyedZ<T extends z.ZodType>(keys: readonly string[], value: T) {
  return z.object(Object.fromEntries(keys.map((k) => [k, value])) as Record<string, T>);
}

function issuesOf(error: z.ZodError): string[] {
  return error.issues.slice(0, 12).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

const blueprintZ = z.object({
  canvas: text,
  sections: z.array(z.object({ name: text, box: text, layout: text, content: text, style: text })),
  assets: z.array(z.object({ name: text, look: text, placement: text })),
});

export function parseBlueprint(raw: unknown): Parsed<Blueprint> {
  const result = z.object({ blueprint: blueprintZ }).safeParse(raw);
  if (!result.success) return { ok: false, issues: issuesOf(result.error) };
  return { ok: true, data: result.data.blueprint };
}

export function parseObservation(mode: Mode, raw: unknown, includeBlueprint = false): Parsed<Observation> {
  const schema = z.object({
    ...(includeBlueprint ? { blueprint: blueprintZ } : {}),
    gist: text,
    keywords: stringList,
    signature: stringList,
    palette: z.array(z.object({ hex, role: text, share })),
    d: keyedZ(dimensionsFor(mode), findingZ),
  });
  const result = schema.safeParse(raw);
  if (!result.success) return { ok: false, issues: issuesOf(result.error) };
  return { ok: true, data: result.data as Observation };
}

const NAME_WORDS = 3;

function cleanName(value: string): string {
  const words = value.replace(/["“”]/g, '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, NAME_WORDS).join(' ') || 'Untitled';
}

export function parseTranslation(mode: 'web', raw: unknown, collectionNames?: readonly string[]): Parsed<WebTranslation>;
export function parseTranslation(mode: 'image', raw: unknown, collectionNames?: readonly string[]): Parsed<ImageTranslation>;
export function parseTranslation(mode: Mode, raw: unknown, collectionNames?: readonly string[]): Parsed<Translation>;
export function parseTranslation(mode: Mode, raw: unknown, collectionNames: readonly string[] = []): Parsed<Translation> {
  const base = {
    name: text.transform(cleanName),
    category: z.unknown().transform(coerceCategory),
    tags: z.unknown().transform((v) => normalizeTags(v)),
    // Missing or unknown names are dropped rather than failing the whole answer.
    collections: z.unknown().transform((v) => pickCollections(v, [...collectionNames])),
    note: text,
  };
  const schema =
    mode === 'web'
      ? z.object({
          ...base,
          web: keyedZ(dimensionsFor('web'), text),
          tokens: z.object({
            colors: z.array(z.object({ role: text, hex })),
            type: z.object({
              display: text, text, mono: text, scale: text, weights: text, tracking: text, leading: text,
            }),
            spacing: text,
            radius: text,
            border: text,
            shadow: text,
            motion: text,
          }),
          build: stringList,
          avoid: stringList,
        })
      : z.object({
          ...base,
          gen: keyedZ(dimensionsFor('image'), text),
          prompt: text,
          negative: stringList,
          params: z.object({ aspect_ratio: text, medium: text, notes: text }),
        });
  const result = schema.safeParse(raw);
  if (!result.success) return { ok: false, issues: issuesOf(result.error) };
  return { ok: true, data: result.data as Translation };
}
