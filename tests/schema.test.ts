import { describe, expect, it } from 'vitest';
import { dimensionsFor, RUBRIC } from '@/lib/ai/schema/dimensions';
import {
  blueprintJsonSchema,
  observationJsonSchema,
  parseBlueprint,
  parseObservation,
  parseTranslation,
  translationJsonSchema,
} from '@/lib/ai/schema/wire';
import { buildSpec, mergeObservations, observationDigest } from '@/lib/ai/schema/expand';
import { composePrompt } from '@/lib/copy/compose';
import { sampleBlueprint, sampleImageTranslation, sampleObservation, sampleWebTranslation } from './fixtures';

type Json = { [key: string]: unknown };

/** Strict mode needs every object to list all its keys as required and forbid extras. */
function strictViolations(schema: Json, path = '$'): string[] {
  const out: string[] = [];
  if (schema.type === 'object') {
    const props = (schema.properties ?? {}) as Record<string, Json>;
    const keys = Object.keys(props);
    if (schema.additionalProperties !== false) out.push(`${path}: additionalProperties`);
    const required = (schema.required ?? []) as string[];
    if (keys.length !== required.length || keys.some((k) => !required.includes(k))) out.push(`${path}: required`);
    for (const key of keys) out.push(...strictViolations(props[key], `${path}.${key}`));
  }
  if (schema.type === 'array' && schema.items) out.push(...strictViolations(schema.items as Json, `${path}[]`));
  return out;
}

describe('dimensions', () => {
  it('gives 27 per mode, sharing the first 24', () => {
    const web = dimensionsFor('web');
    const image = dimensionsFor('image');
    expect(web).toHaveLength(27);
    expect(image).toHaveLength(27);
    expect(web.slice(0, 24)).toEqual(image.slice(0, 24));
    expect(web.slice(24)).toEqual(['interaction_cues', 'motion_cues', 'responsive_cues']);
    expect(image.slice(24)).toEqual(['medium_technique', 'camera_lens', 'subject_treatment']);
  });

  it('has a rubric hint for every dimension', () => {
    for (const key of [...dimensionsFor('web'), ...dimensionsFor('image')]) {
      expect(RUBRIC[key], key).toBeTruthy();
    }
  });
});

describe('JSON schemas sent to the model', () => {
  it('are strict-mode compliant', () => {
    for (const mode of ['web', 'image'] as const) {
      expect(strictViolations(observationJsonSchema(mode) as Json), `observation ${mode}`).toEqual([]);
      expect(strictViolations(translationJsonSchema(mode) as Json), `translation ${mode}`).toEqual([]);
    }
  });

  it('ask for the page blueprint on its own or together with the dimensions, strictly', () => {
    expect(strictViolations(blueprintJsonSchema() as Json)).toEqual([]);
    const both = observationJsonSchema('web', true) as Json;
    expect(strictViolations(both)).toEqual([]);
    expect(Object.keys(both.properties as object)).toContain('blueprint');
    expect(Object.keys((observationJsonSchema('web') as Json).properties as object)).not.toContain('blueprint');
  });

  it('list all 27 dimensions and restrict category to the 30 names', () => {
    const obs = observationJsonSchema('web') as Json;
    const d = (obs.properties as Record<string, Json>).d;
    expect(Object.keys(d.properties as object)).toEqual([...dimensionsFor('web')]);
    const tr = translationJsonSchema('web') as Json;
    const category = (tr.properties as Record<string, Json>).category;
    expect((category.enum as string[]).length).toBe(30);
  });
});

describe('parseBlueprint', () => {
  it('accepts a blueprint and rejects one without sections', () => {
    expect(parseBlueprint({ blueprint: sampleBlueprint() }).ok).toBe(true);
    const bad = parseBlueprint({ blueprint: { canvas: 'x', assets: [] } });
    expect(bad.ok).toBe(false);
  });

  it('flows into the spec ahead of the system, and into the digest as an outline only', () => {
    const observation = sampleObservation('web', { blueprint: sampleBlueprint() });
    const spec = buildSpec({
      mode: 'web',
      observation,
      translation: sampleWebTranslation(),
      identity: { name: 'Glass Dusk', category: 'Landing Page', tags: [] },
    });
    const keys = Object.keys(spec);
    expect(keys.indexOf('blueprint')).toBeGreaterThan(keys.indexOf('palette'));
    expect(keys.indexOf('blueprint')).toBeLessThan(keys.indexOf('system'));
    const digest = observationDigest(observation, 'web');
    expect(digest).toContain('Header (flex row');
    expect(digest).not.toContain('Light after dark');
  });
});

describe('parseObservation', () => {
  it('accepts a complete observation', () => {
    const result = parseObservation('web', sampleObservation('web'));
    expect(result.ok).toBe(true);
  });

  it('normalises percent-style confidence and hex case', () => {
    const raw = sampleObservation('web');
    raw.d.composition.c = 85;
    raw.palette[0].hex = '1b1430';
    const result = parseObservation('web', raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.d.composition.c).toBe(0.85);
      expect(result.data.palette[0].hex).toBe('#1B1430');
    }
  });

  it('reports a missing dimension', () => {
    const raw = sampleObservation('web');
    delete (raw.d as Record<string, unknown>).typography;
    const result = parseObservation('web', raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(' ')).toMatch(/typography/);
  });
});

describe('parseTranslation', () => {
  it('accepts web and image translations', () => {
    expect(parseTranslation('web', sampleWebTranslation()).ok).toBe(true);
    expect(parseTranslation('image', sampleImageTranslation()).ok).toBe(true);
  });

  it('coerces an unknown category and cleans tags', () => {
    const raw = { ...sampleWebTranslation(), category: 'Spaceships', tags: ['Frosted Glass', 'frosted glass', '#Dusk'] };
    const result = parseTranslation('web', raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.category).toBe('Abstract, Pattern & Texture');
      expect(result.data.tags).toEqual(['frosted glass', 'dusk']);
    }
  });

  it('trims a name to three words', () => {
    const result = parseTranslation('web', { ...sampleWebTranslation(), name: 'Very Long Glass Dusk Name' });
    expect(result.ok && result.data.name).toBe('Very Long Glass');
  });
});

describe('mergeObservations', () => {
  it('returns a single observation unchanged', () => {
    const one = sampleObservation('web');
    expect(mergeObservations([one])).toEqual(one);
  });

  it('keeps the most confident finding per dimension and notes disagreement', () => {
    const a = sampleObservation('web');
    const b = sampleObservation('web');
    a.d.typography = { v: 'grotesque sans', e: 'uniform strokes', l: 'top-left', m: '14 units', c: 0.6 };
    b.d.typography = { v: 'high-contrast serif', e: 'hairline serifs', l: 'centre', m: '90 units', c: 0.9 };
    const merged = mergeObservations([a, b]);
    expect(merged.d.typography.v).toBe('high-contrast serif');
    expect(merged.d.typography.e).toMatch(/frame 1: grotesque sans/);
    // identical findings are not annotated
    expect(merged.d.composition.e).toBe('composition evidence');
  });

  it('unions keywords and signature, and averages palette share by colour', () => {
    const a = sampleObservation('web', { keywords: ['glass', 'dusk'], signature: ['panels'] });
    const b = sampleObservation('web', {
      keywords: ['dusk', 'neon'],
      signature: ['panels', 'amber light'],
      palette: [
        { hex: '#1B1430', role: 'background', share: 0.42 },
        { hex: '#FFFFFF', role: 'text', share: 0.1 },
      ],
    });
    const merged = mergeObservations([a, b]);
    expect(merged.keywords).toEqual(['glass', 'dusk', 'neon']);
    expect(merged.signature).toEqual(['panels', 'amber light']);
    expect(merged.palette[0]).toEqual({ hex: '#1B1430', role: 'background', share: 0.5 });
    expect(merged.palette.map((p) => p.hex)).toContain('#FFFFFF');
    expect(merged.gist).toContain('Three frosted panels');
  });
});

describe('observationDigest', () => {
  it('lists every dimension without the evidence text', () => {
    const digest = observationDigest(sampleObservation('web'), 'web');
    for (const key of dimensionsFor('web')) expect(digest).toContain(`${key}:`);
    expect(digest).not.toContain('composition evidence');
    expect(digest).toContain('#1B1430');
  });
});

describe('buildSpec', () => {
  const identity = { name: 'Glass Dusk', category: 'Landing Page' as const, tags: ['frosted glass'] };

  it('expands a web analysis into the readable spec', () => {
    const spec = buildSpec({
      mode: 'web',
      observation: sampleObservation('web'),
      translation: sampleWebTranslation(),
      identity,
    });
    expect(spec.inspi).toBe('web/1');
    expect(Object.keys(spec)).toEqual([
      'inspi', 'name', 'category', 'tags', 'note', 'signature', 'palette', 'system', 'tokens', 'build', 'avoid',
    ]);
    expect(Object.keys(spec.system)).toEqual([...dimensionsFor('web')]);
    expect(spec.system.composition).toEqual({
      value: 'composition value',
      evidence: 'composition evidence',
      location: 'centre',
      magnitude: '50%',
      confidence: 0.7,
      web: 'composition css',
    });
    if (spec.inspi === 'web/1') expect(spec.tokens.colors).toEqual({ background: '#1B1430', accent: '#F2A65A' });
  });

  it('expands an image analysis with generator phrasing', () => {
    const spec = buildSpec({
      mode: 'image',
      observation: sampleObservation('image'),
      translation: sampleImageTranslation(),
      identity: { ...identity, category: '3D & Render' },
    });
    expect(spec.inspi).toBe('image/1');
    expect(spec.system.camera_lens.gen).toBe('camera_lens phrase');
    if (spec.inspi === 'image/1') {
      expect(spec.prompt).toMatch(/frosted/);
      expect(spec.negative).toEqual(['hard shadows', 'text']);
    }
  });

  it('uses the entry identity rather than the translation', () => {
    const spec = buildSpec({
      mode: 'web',
      observation: sampleObservation('web'),
      translation: { ...sampleWebTranslation(), name: 'Something Else', tags: ['other'] },
      identity,
    });
    expect(spec.name).toBe('Glass Dusk');
    expect(spec.tags).toEqual(['frosted glass']);
  });
});

describe('composePrompt', () => {
  it('prefixes the instruction for the mode and ends with the exact JSON', () => {
    const spec = buildSpec({
      mode: 'web',
      observation: sampleObservation('web'),
      translation: sampleWebTranslation(),
      identity: { name: 'Glass Dusk', category: 'Landing Page', tags: ['frosted glass'] },
    });
    const text = composePrompt(spec);
    expect(text.startsWith('Rebuild the page described below')).toBe(true);
    const json = text.slice(text.indexOf('\n{'));
    expect(JSON.parse(json)).toEqual(spec);
  });

  it('uses image wording for image specs', () => {
    const spec = buildSpec({
      mode: 'image',
      observation: sampleObservation('image'),
      translation: sampleImageTranslation(),
      identity: { name: 'Glass Dusk', category: '3D & Render', tags: [] },
    });
    expect(composePrompt(spec)).toMatch(/^Generate an image in the visual style described below/);
  });
});
