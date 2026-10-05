import type { Category } from '../../library/categories';
import type { Mode } from '../../types';
import { dimensionsFor, WEB_DIMENSIONS } from './dimensions';
import type { ImageFinding, ImageSpec, Spec, WebFinding, WebSpec, SubjectMode } from './display';
import type { ImageTranslation, Observation, PaletteColor, PatternComponent, Patterns, Translation, WebTranslation, WireFinding } from './wire';

const INFERRED = new Set<string>(WEB_DIMENSIONS);

const MAX_KEYWORDS = 12;
const MAX_SIGNATURE = 5;
const MAX_PALETTE = 8;

function union(lists: string[][], max: number): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (!out.includes(item)) out.push(item);
    }
  }
  return out.slice(0, max);
}

function mergePalettes(palettes: PaletteColor[][]): PaletteColor[] {
  const byHex = new Map<string, { role: string; shares: number[] }>();
  for (const palette of palettes) {
    for (const color of palette) {
      const seen = byHex.get(color.hex);
      if (seen) seen.shares.push(color.share);
      else byHex.set(color.hex, { role: color.role, shares: [color.share] });
    }
  }
  return [...byHex.entries()]
    .map(([hex, { role, shares }]) => ({
      hex,
      role,
      // A colour missing from a frame counts as zero there.
      share: Math.round((shares.reduce((a, b) => a + b, 0) / palettes.length) * 100) / 100,
    }))
    .sort((a, b) => b.share - a.share)
    .slice(0, MAX_PALETTE);
}

const MAX_COMPONENTS = 10;

/**
 * Frames of one set share one grammar: components are pooled (a block seen in several frames keeps
 * its first, most confident description), the first frame's motif and voice lead, identity is pooled.
 */
function mergePatterns(list: Observation[]): Patterns | undefined {
  const parts = list.map((o) => o.patterns).filter((p): p is Patterns => Boolean(p));
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  const components: PatternComponent[] = [];
  for (const part of parts) {
    for (const component of part.components) {
      if (!components.some((c) => c.name.toLowerCase() === component.name.toLowerCase())) components.push(component);
    }
  }
  return {
    page: parts.map((p, i) => `Frame ${i + 1}: ${p.page}`).join(' '),
    components: components.slice(0, MAX_COMPONENTS),
    motif: parts.find((p) => p.motif.what && p.motif.what !== 'none')?.motif ?? parts[0].motif,
    voice: parts[0].voice,
    identity: union(parts.map((p) => p.identity), 20),
  };
}

/**
 * Combines per-frame observations without another model call: the most confident finding wins each
 * dimension, and frames that saw something different are noted in its evidence.
 */
export function mergeObservations(list: Observation[]): Observation {
  if (list.length === 1) return list[0];

  const d: Record<string, WireFinding> = {};
  for (const key of Object.keys(list[0].d)) {
    const findings = list.map((o, frame) => ({ frame: frame + 1, f: o.d[key] })).filter((x) => x.f);
    const best = findings.reduce((a, b) => (b.f.c > a.f.c ? b : a));
    const others = findings.filter((x) => x !== best && x.f.v !== best.f.v && x.f.v !== 'none');
    d[key] = others.length
      ? { ...best.f, e: `${best.f.e} (${others.map((x) => `frame ${x.frame}: ${x.f.v}`).join('; ')})` }
      : best.f;
  }

  return {
    gist: union(list.map((o) => [o.gist]), list.length).join(' '),
    keywords: union(list.map((o) => o.keywords), MAX_KEYWORDS),
    signature: union(list.map((o) => o.signature), MAX_SIGNATURE),
    palette: mergePalettes(list.map((o) => o.palette)),
    d,
    ...(list.some((o) => o.patterns) ? { patterns: mergePatterns(list) } : {}),
  };
}

/** The observation as terse text for the translate pass: findings without their evidence. */
export function observationDigest(obs: Observation, mode: Mode): string {
  const lines = [
    `gist: ${obs.gist}`,
    `keywords: ${obs.keywords.join(', ')}`,
    `signature: ${obs.signature.join(' | ')}`,
    `palette: ${obs.palette.map((p) => `${p.hex} ${p.role} ${Math.round(p.share * 100)}%`).join(', ')}`,
  ];
  // The patterns go into the spec as they are; the translator sees them to write keep, adapt and avoid.
  if (obs.patterns) {
    const p = obs.patterns;
    lines.push(`page: ${p.page}`);
    lines.push(`components: ${p.components.map((c) => `${c.name} [${c.importance}] (${c.structure})`).join('; ')}`);
    lines.push(`motif: ${p.motif.what}; built as ${p.motif.how}; transform: ${p.motif.transform}`);
    lines.push(`voice: ${p.voice}`);
    if (p.identity.length) lines.push(`source identity (never reuse): ${p.identity.join('; ')}`);
  }
  lines.push('');
  for (const key of dimensionsFor(mode)) {
    const f = obs.d[key];
    lines.push(`${key}: ${f.v} [${f.m}] @${f.l} (c=${f.c})`);
  }
  return lines.join('\n');
}

export interface SpecInput {
  mode: Mode;
  observation: Observation;
  translation: Translation;
  /** The entry's own name, category and tags: stable across retries. */
  identity: { name: string; category: Category; tags: string[] };
  /** Changes the person asked for when adding the entry. */
  changes?: string;
  /** Image entries: the subject choice the entry's prompt makes by default. */
  subject?: { mode: SubjectMode; text?: string } | null;
}

export function buildSpec(input: { mode: 'web' } & Omit<SpecInput, 'mode'>): WebSpec;
export function buildSpec(input: { mode: 'image' } & Omit<SpecInput, 'mode'>): ImageSpec;
export function buildSpec(input: SpecInput): Spec;
export function buildSpec({ mode, observation, translation, identity, changes, subject: choice }: SpecInput): Spec {
  const finding = (key: string) => {
    const f = observation.d[key];
    return { value: f.v, evidence: f.e, location: f.l, magnitude: f.m, confidence: f.c };
  };
  const head = {
    name: identity.name,
    category: identity.category,
    tags: identity.tags,
    note: translation.note,
    signature: observation.signature,
    palette: observation.palette,
    ...(changes ? { changes } : {}),
  };

  if (mode === 'web') {
    const t = translation as WebTranslation;
    const system: Record<string, WebFinding> = {};
    for (const key of dimensionsFor('web')) {
      const f = finding(key);
      // Behaviour is read from a still image, so it is always a guess; so is anything seen only faintly.
      const basis = INFERRED.has(key) || f.confidence < 0.5 ? 'inferred' : 'observed';
      system[key] = { ...f, basis, priority: t.priority?.[key] ?? 'medium', web: t.web[key] };
    }
    const identity = observation.patterns?.identity ?? [];
    const avoid = [...t.avoid];
    // Whatever the translator wrote, the source's own identity is always ruled out by name.
    if (identity.length) avoid.push(`Reusing anything that belongs to the source: ${identity.join('; ')}`);
    const patterns = observation.patterns ? { page: observation.patterns.page, components: observation.patterns.components, motif: observation.patterns.motif, voice: observation.patterns.voice } : undefined;
    return {
      inspi: 'web/2',
      ...head,
      ...(patterns ? { patterns } : {}),
      system,
      tokens: { ...t.tokens, colors: Object.fromEntries(t.tokens.colors.map((c) => [c.role, c.hex])) },
      keep: t.keep,
      adapt: t.adapt,
      avoid,
      build: t.build,
    };
  }

  const t = translation as ImageTranslation;
  const system: Record<string, ImageFinding> = {};
  for (const key of dimensionsFor('image')) system[key] = { ...finding(key), gen: t.gen[key] };
  // With changes asked for, the translation's rewrite wins: the observed gist would still say "at night".
  const subject = (changes ? t.subject?.trim() : '') || observation.gist.trim();
  return {
    inspi: 'image/1',
    ...head,
    system,
    prompt: t.prompt,
    negative: t.negative,
    params: t.params,
    ...(subject ? { subject } : {}),
    ...(choice ? { subjectMode: choice.mode, ...(choice.mode === 'mine' && choice.text ? { mySubject: choice.text } : {}) } : {}),
  };
}
