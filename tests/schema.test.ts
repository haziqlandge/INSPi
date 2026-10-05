import { describe, expect, it } from 'vitest';
import { dimensionsFor, RUBRIC } from '@/lib/ai/schema/dimensions';
import {
  observationJsonSchema,
  parsePatterns,
  parseObservation,
  patternsJsonSchema,
  parseTranslation,
  translationJsonSchema,
} from '@/lib/ai/schema/wire';
import { buildSpec, mergeObservations, observationDigest } from '@/lib/ai/schema/expand';
import { composePrompt } from '@/lib/copy/compose';
import { samplePatterns, sampleImageTranslation, sampleObservation, sampleWebTranslation } from './fixtures';

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

  it('ask for the page patterns on their own or together with the dimensions, strictly', () => {
    expect(strictViolations(patternsJsonSchema() as Json)).toEqual([]);
    const both = observationJsonSchema('web', true) as Json;
    expect(strictViolations(both)).toEqual([]);
    expect(Object.keys(both.properties as object)).toContain('patterns');
    expect(Object.keys((observationJsonSchema('web') as Json).properties as object)).not.toContain('patterns');
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

describe('patterns (web inspiration)', () => {
  it('accepts patterns, reads an odd importance as medium, and rejects patterns without components', () => {
    const raw = samplePatterns();
    (raw.components[0] as { importance: string }).importance = 'CRUCIAL';
    const parsed = parsePatterns({ patterns: raw });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.components[0].importance).toBe('medium');
    expect(parsePatterns({ patterns: { page: 'x', motif: { what: '', how: '', transform: '' }, voice: '', identity: [] } }).ok).toBe(false);
  });

  const web = () => {
    const observation = sampleObservation('web', { patterns: samplePatterns() });
    observation.d.lighting.c = 0.3;
    return {
      observation,
      spec: buildSpec({ mode: 'web', observation, translation: sampleWebTranslation(), identity: { name: 'Glass Dusk', category: 'Landing Page', tags: [] } }),
    };
  };

  it('makes an inspiration spec: patterns after the palette, then system, keep, adapt, avoid', () => {
    const { spec } = web();
    expect(spec.inspi).toBe('web/2');
    const keys = Object.keys(spec);
    expect(keys.indexOf('patterns')).toBeGreaterThan(keys.indexOf('palette'));
    expect(keys.indexOf('patterns')).toBeLessThan(keys.indexOf('system'));
    expect(keys.indexOf('keep')).toBeLessThan(keys.indexOf('avoid'));
    expect(spec.patterns).not.toHaveProperty('identity');
    expect(spec).not.toHaveProperty('blueprint');
  });

  it('marks each finding as observed or inferred, and carries its priority', () => {
    const { spec } = web();
    expect(spec.system.composition).toMatchObject({ basis: 'observed', priority: 'medium' });
    expect(spec.system.color_system.priority).toBe('high');
    expect(spec.system.lighting.basis).toBe('inferred');
    expect(spec.system.motion_cues.basis).toBe('inferred');
  });

  it('always rules out the source identity by name, and keeps it out of everything else', () => {
    const { spec, observation } = web();
    expect(spec.avoid.at(-1)).toContain('Dusk wordmark');
    const digest = observationDigest(observation, 'web');
    expect(digest).toContain('source identity (never reuse): Dusk wordmark');
    expect(digest).toContain('Hero [high]');
  });

  it('tells the builder to use it as inspiration, not to copy it', () => {
    const prompt = composePrompt(web().spec);
    expect(prompt).toMatch(/^Use the reference described below as inspiration/);
    expect(prompt).toContain('never reproduce the reference');
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
    expect(spec.inspi).toBe('web/2');
    expect(Object.keys(spec)).toEqual([
      'inspi', 'name', 'category', 'tags', 'note', 'signature', 'palette', 'system', 'tokens', 'keep', 'adapt', 'avoid', 'build',
    ]);
    expect(Object.keys(spec.system)).toEqual([...dimensionsFor('web')]);
    expect(spec.system.composition).toEqual({
      value: 'composition value',
      evidence: 'composition evidence',
      location: 'centre',
      magnitude: '50%',
      confidence: 0.7,
      basis: 'observed',
      priority: 'medium',
      web: 'composition css',
    });
    if (spec.inspi === 'web/2') expect(spec.tokens.colors).toEqual({ background: '#1B1430', accent: '#F2A65A' });
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
    expect(text.startsWith('Use the reference described below as inspiration')).toBe(true);
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

describe('subject modes', () => {
  const spec = () =>
    buildSpec({
      mode: 'image',
      observation: sampleObservation('image'),
      translation: sampleImageTranslation(),
      identity: { name: 'Glass Dusk', category: '3D & Render', tags: [] },
    });
  const json = (text: string) => JSON.parse(text.slice(text.indexOf('\n{')));

  it('image specs keep what the reference shows, from the observation', () => {
    expect(spec().subject).toBe('Three frosted panels over a dusk gradient.');
  });

  it("model's choice (and Copy prompt) leaves the subject out of the JSON", () => {
    const text = composePrompt(spec());
    expect(text).toMatch(/with a subject of your own/);
    expect(json(text).subject).toBeUndefined();
  });

  it('recreate names the subject first and keeps it in the JSON', () => {
    const text = composePrompt(spec(), { mode: 'recreate' });
    expect(text).toMatch(/^Recreate the reference image described below/);
    expect(text).toContain('Subject: Three frosted panels over a dusk gradient.');
    expect(json(text)).toEqual(spec());
  });

  it('recreate uses an edited subject when given one', () => {
    expect(composePrompt(spec(), { mode: 'recreate', text: '  A red sun\n over hills ' })).toContain('Subject: A red sun over hills');
  });

  it("my subject draws the person's subject in the style, without the reference's", () => {
    const text = composePrompt(spec(), { mode: 'mine', text: 'a lighthouse at dusk' });
    expect(text).toMatch(/^Generate an image of: a lighthouse at dusk\nRender it in the visual style described below/);
    expect(json(text).subject).toBeUndefined();
  });

  it("falls back to model's choice when there is no subject to use", () => {
    const { subject: _s, ...old } = spec();
    expect(composePrompt(old, { mode: 'recreate' })).toMatch(/^Generate an image in the visual style/);
    expect(composePrompt(spec(), { mode: 'mine', text: '  ' })).toMatch(/^Generate an image in the visual style/);
  });
});

describe('changes from the reference', () => {
  const spec = (changes?: string) =>
    buildSpec({
      mode: 'image',
      observation: sampleObservation('image'),
      translation: sampleImageTranslation(),
      identity: { name: 'Glass Dusk', category: '3D & Render', tags: [] },
      changes,
    });

  it('the spec keeps them, and every prompt states them before the JSON', () => {
    const s = spec('make it night time, teal not red');
    expect(s.changes).toBe('make it night time, teal not red');
    for (const subject of [{ mode: 'model' as const }, { mode: 'recreate' as const }, { mode: 'mine' as const, text: 'a fox' }]) {
      const text = composePrompt(s, subject);
      const head = text.slice(0, text.indexOf('\n{'));
      expect(head).toContain('Changes from the reference. They override the subject, the JSON');
      expect(head).toContain('keep everything else as it is: make it night time, teal not red');
      // On the second line, so a model that reads only the start of a long prompt sees it before the subject.
      expect(head.split('\n')[1]).toContain('make it night time, teal not red');
    }
  });

  it('the subject is the translation\'s rewrite when changes were asked for, else the observed gist', () => {
    const rewritten = { ...sampleImageTranslation(), subject: 'A black sports car on a wet coastal road at sunrise.' };
    const build = (changes?: string) =>
      buildSpec({
        mode: 'image',
        observation: sampleObservation('image'),
        translation: rewritten,
        identity: { name: 'Glass Dusk', category: '3D & Render', tags: [] },
        changes,
      });
    expect((build('make it morning by the coast') as { subject?: string }).subject).toBe(rewritten.subject);
    // No changes: whatever the model wrote there is ignored in favour of what was observed.
    expect((build() as { subject?: string }).subject).toBe(sampleObservation('image').gist.trim());
  });

  it('without changes nothing is added', () => {
    expect(spec().changes).toBeUndefined();
    expect(composePrompt(spec())).not.toContain('Changes from the reference');
  });

  it('are tidied and capped, and reach the translate pass only', async () => {
    const { readChanges, changesBlock, CHANGES_MAX } = await import('@/lib/ai/prompts/steer');
    expect(readChanges('  night   time \n\n  no text ')).toBe('night time\nno text');
    expect(readChanges('x'.repeat(900))).toHaveLength(CHANGES_MAX);
    expect(readChanges(42)).toBe('');
    expect(changesBlock('night time', 'image')).toMatch(/"prompt", every "gen" fragment/);
    expect(changesBlock('', 'image')).toBe('');
  });
});

describe("the entry's own subject choice", () => {
  const spec = (subject?: { mode: 'recreate' | 'mine' | 'model'; text?: string }) =>
    buildSpec({
      mode: 'image',
      observation: sampleObservation('image'),
      translation: sampleImageTranslation(),
      identity: { name: 'Glass Dusk', category: '3D & Render', tags: [] },
      subject,
    });

  it('Copy prompt follows the choice made when the entry was added', () => {
    expect(composePrompt(spec({ mode: 'recreate' }))).toMatch(/^Recreate the reference image/);
    expect(composePrompt(spec({ mode: 'mine', text: 'a red fox' }))).toMatch(/^Generate an image of: a red fox/);
    expect(composePrompt(spec({ mode: 'model' }))).toMatch(/^Generate an image in the visual style/);
    expect(composePrompt(spec())).toMatch(/^Generate an image in the visual style/);
  });

  it('keeps the bookkeeping out of the JSON a model reads', () => {
    const text = composePrompt(spec({ mode: 'mine', text: 'a red fox' }));
    expect(text).not.toContain('subjectMode');
    expect(text).not.toContain('mySubject');
  });

  it('reads a choice from the browser', async () => {
    const { readSubjectChoice } = await import('@/lib/copy/compose');
    expect(readSubjectChoice('recreate', 'ignored')).toEqual({ mode: 'recreate' });
    expect(readSubjectChoice('mine', '  a  fox ')).toEqual({ mode: 'mine', text: 'a fox' });
    expect(readSubjectChoice('mine', ' ')).toBeNull();
    expect(readSubjectChoice('exact', '')).toBeNull();
  });
});
