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

/**
 * The concrete page, transcribed: what the first web prompts (web/1) carried. Kept so older entries
 * still read; new analyses extract `Patterns` instead.
 */
export interface Blueprint {
  canvas: string;
  sections: BlueprintSection[];
  assets: BlueprintAsset[];
}

export type Importance = 'high' | 'medium' | 'low';
export const IMPORTANCE: readonly Importance[] = ['high', 'medium', 'low'];

/** A building block of the page, described as a reusable pattern rather than a copy of this one. */
export interface PatternComponent {
  /** What kind of block it is: "Navigation", "Hero", "Feature cards". */
  name: string;
  /** What it does for the page. */
  role: string;
  /** How it is arranged: grid or flex, alignment, proportions, sizes in px. */
  structure: string;
  /** Fills, borders, radius, shadows, states. */
  style: string;
  importance: Importance;
}

/** The look's signature decorative idea, and how to carry it into a different product. */
export interface Motif {
  what: string;
  how: string;
  transform: string;
}

/** The page's transferable grammar (web mode): what to learn from it, not what to copy. */
export interface Patterns {
  page: string;
  components: PatternComponent[];
  motif: Motif;
  /** Tone and shape of the copy, never the copy itself. */
  voice: string;
  /** Source-specific things seen (logos, brand names, copy, distinctive illustrations) that must not be reused. */
  identity: string[];
}

/**
 * One slice of an observation. A provider that caps output per minute cannot return everything in
 * one answer, so the analysis is asked for in slices and put back together (see `assembleSlices`).
 */
export interface Scope {
  /** The page's patterns (web mode). */
  patterns?: boolean;
  dims?: readonly string[];
  /** gist, keywords, signature and palette. */
  meta?: boolean;
}

export interface SliceResult {
  patterns?: Patterns;
  d?: Record<string, WireFinding>;
  gist?: string;
  keywords?: string[];
  signature?: string[];
  palette?: PaletteColor[];
}

export interface Observation {
  gist: string;
  keywords: string[];
  signature: string[];
  palette: PaletteColor[];
  d: Record<string, WireFinding>;
  /** Web mode only. */
  patterns?: Patterns;
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
  /** How much each dimension matters to the look. */
  priority: Record<string, Importance>;
  tokens: WebTokens;
  /** Principles to carry over as they are. */
  keep: string[];
  /** Patterns worth using, redesigned around the destination project: "coins → the project's own motif". */
  adapt: string[];
  build: string[];
  avoid: string[];
}

export interface ImageTranslation extends TranslationBase {
  gen: Record<string, string>;
  prompt: string;
  negative: string[];
  params: { aspect_ratio: string; medium: string; notes: string };
  /** What the picture shows with the person's changes applied; empty when they asked for none. */
  subject?: string;
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

const importance: JsonSchema = { type: 'string', enum: [...IMPORTANCE] };

const patternsSchema = obj({
  page: str,
  components: { type: 'array', items: obj({ name: str, role: str, structure: str, style: str, importance }) },
  motif: obj({ what: str, how: str, transform: str }),
  voice: str,
  identity: strings,
});

/** The page-patterns half of a web observation, asked for on its own when the budget is small. */
export function patternsJsonSchema(): JsonSchema {
  return obj({ patterns: patternsSchema });
}

/** The measured-dimensions half; `includePatterns` asks for the page patterns in the same answer. */
export function observationJsonSchema(mode: Mode, includePatterns = false): JsonSchema {
  const finding = obj({ v: str, e: str, l: str, m: str, c: num });
  return obj({
    ...(includePatterns ? { patterns: patternsSchema } : {}),
    gist: str,
    keywords: strings,
    signature: strings,
    palette: { type: 'array', items: obj({ hex: str, role: str, share: num }) },
    d: keyed(dimensionsFor(mode), finding),
  });
}

/** The JSON schema for one slice; keys are flat (patterns, d, gist…). */
export function sliceJsonSchema(mode: Mode, scope: Scope): JsonSchema {
  const finding = obj({ v: str, e: str, l: str, m: str, c: num });
  const props: Record<string, JsonSchema> = {};
  if (scope.patterns) props.patterns = patternsSchema;
  if (scope.dims?.length) props.d = keyed(scope.dims, finding);
  if (scope.meta) {
    props.gist = str;
    props.keywords = strings;
    props.signature = strings;
    props.palette = { type: 'array', items: obj({ hex: str, role: str, share: num }) };
  }
  void mode;
  return obj(props);
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
      priority: keyed(dimensionsFor('web'), importance),
      tokens: obj({
        colors: { type: 'array', items: obj({ role: str, hex: str }) },
        type: obj({ display: str, text: str, mono: str, scale: str, weights: str, tracking: str, leading: str }),
        spacing: str,
        radius: str,
        border: str,
        shadow: str,
        motion: str,
      }),
      keep: strings,
      adapt: strings,
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
    subject: str,
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

/** Anything unrecognised counts as medium rather than failing the answer. */
const importanceZ = z.unknown().transform((v): Importance => {
  const word = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (IMPORTANCE as readonly string[]).includes(word) ? (word as Importance) : 'medium';
});

const patternsZ = z.object({
  page: text,
  components: z.array(z.object({ name: text, role: text, structure: text, style: text, importance: importanceZ })),
  motif: z.object({ what: text, how: text, transform: text }),
  voice: text,
  identity: stringList,
});

export function parsePatterns(raw: unknown): Parsed<Patterns> {
  const result = z.object({ patterns: patternsZ }).safeParse(raw);
  if (!result.success) return { ok: false, issues: issuesOf(result.error) };
  return { ok: true, data: result.data.patterns };
}

export function parseSlice(mode: Mode, raw: unknown, scope: Scope): Parsed<SliceResult> {
  void mode;
  const shape: Record<string, z.ZodType> = {};
  if (scope.patterns) shape.patterns = patternsZ;
  if (scope.dims?.length) shape.d = keyedZ(scope.dims, findingZ);
  if (scope.meta) {
    shape.gist = text;
    shape.keywords = stringList;
    shape.signature = stringList;
    shape.palette = z.array(z.object({ hex, role: text, share }));
  }
  const result = z.object(shape).safeParse(raw);
  if (!result.success) return { ok: false, issues: issuesOf(result.error) };
  return { ok: true, data: result.data as SliceResult };
}

/** Puts the slices of one frame back together as a single observation, whatever order they arrived in. */
export function assembleSlices(slices: SliceResult[]): Observation {
  const merged: SliceResult = {};
  const d: Record<string, WireFinding> = {};
  for (const slice of slices) {
    Object.assign(d, slice.d ?? {});
    const { d: _ignored, ...rest } = slice;
    void _ignored;
    Object.assign(merged, rest);
  }
  return {
    gist: merged.gist ?? '',
    keywords: merged.keywords ?? [],
    signature: merged.signature ?? [],
    palette: merged.palette ?? [],
    d,
    ...(merged.patterns ? { patterns: merged.patterns } : {}),
  };
}

export function parseObservation(mode: Mode, raw: unknown, includePatterns = false): Parsed<Observation> {
  const schema = z.object({
    ...(includePatterns ? { patterns: patternsZ } : {}),
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
          // A missing or partial priority map is filled with "medium" rather than failing the answer.
          priority: z.unknown().transform((v) => {
            const given = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
            return Object.fromEntries(dimensionsFor('web').map((key) => [key, importanceZ.parse(given[key])])) as Record<string, Importance>;
          }),
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
          keep: stringList,
          adapt: stringList,
          build: stringList,
          avoid: stringList,
        })
      : z.object({
          ...base,
          gen: keyedZ(dimensionsFor('image'), text),
          prompt: text,
          negative: stringList,
          params: z.object({ aspect_ratio: text, medium: text, notes: text }),
          // Optional: only asked for when the person gave changes, so a missing one is not an error.
          subject: z.preprocess((v) => (typeof v === 'string' ? v.trim() : ''), z.string()),
        });
  const result = schema.safeParse(raw);
  if (!result.success) return { ok: false, issues: issuesOf(result.error) };
  return { ok: true, data: result.data as Translation };
}
