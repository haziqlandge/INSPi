import type { Category } from '../../library/categories';
import type { Mode } from '../../types';
import { dimensionsFor } from './dimensions';
import type { ImageFinding, ImageSpec, Spec, WebFinding, WebSpec } from './display';
import type { Blueprint, ImageTranslation, Observation, PaletteColor, Translation, WebTranslation, WireFinding } from './wire';

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

/** Frames of one set are kept apart: each keeps its own sections and assets, named by frame. */
function mergeBlueprints(list: Observation[]): Blueprint | undefined {
  const parts = list.map((o, i) => ({ frame: i + 1, b: o.blueprint })).filter((x): x is { frame: number; b: Blueprint } => Boolean(x.b));
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0].b;
  return {
    canvas: parts.map((x) => `Frame ${x.frame}: ${x.b.canvas}`).join(' '),
    sections: parts.flatMap((x) => x.b.sections.map((s) => ({ ...s, name: `Frame ${x.frame}: ${s.name}` }))),
    assets: parts.flatMap((x) => x.b.assets.map((a) => ({ ...a, name: `Frame ${x.frame}: ${a.name}` }))),
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
    blueprint: mergeBlueprints(list),
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
  // Only the outline: the full blueprint goes into the spec as it is, so the translator need not repeat it.
  if (obs.blueprint) {
    lines.push(`page: ${obs.blueprint.canvas}`);
    lines.push(`sections, top to bottom: ${obs.blueprint.sections.map((s) => `${s.name} (${s.layout})`).join('; ')}`);
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
}

export function buildSpec(input: { mode: 'web' } & Omit<SpecInput, 'mode'>): WebSpec;
export function buildSpec(input: { mode: 'image' } & Omit<SpecInput, 'mode'>): ImageSpec;
export function buildSpec(input: SpecInput): Spec;
export function buildSpec({ mode, observation, translation, identity }: SpecInput): Spec {
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
  };

  if (mode === 'web') {
    const t = translation as WebTranslation;
    const system: Record<string, WebFinding> = {};
    for (const key of dimensionsFor('web')) system[key] = { ...finding(key), web: t.web[key] };
    return {
      inspi: 'web/1',
      ...head,
      ...(observation.blueprint ? { blueprint: observation.blueprint } : {}),
      system,
      tokens: { ...t.tokens, colors: Object.fromEntries(t.tokens.colors.map((c) => [c.role, c.hex])) },
      build: t.build,
      avoid: t.avoid,
    };
  }

  const t = translation as ImageTranslation;
  const system: Record<string, ImageFinding> = {};
  for (const key of dimensionsFor('image')) system[key] = { ...finding(key), gen: t.gen[key] };
  return { inspi: 'image/1', ...head, system, prompt: t.prompt, negative: t.negative, params: t.params };
}
