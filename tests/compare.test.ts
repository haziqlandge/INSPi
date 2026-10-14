import { describe, expect, it } from 'vitest';
import { buildSpec } from '@/lib/ai/schema/expand';
import type { WebSpec } from '@/lib/ai/schema/display';
import { compareSpecs, summarize, wordDiff } from '@/lib/client/compare';
import { samplePatterns, sampleObservation, sampleWebTranslation } from './fixtures';

const identity = { name: 'Glass Dusk', category: 'Landing Page' as const, tags: ['dusk'] };
const spec = (): WebSpec =>
  buildSpec({ mode: 'web', observation: sampleObservation('web', { patterns: samplePatterns() }), translation: sampleWebTranslation(), identity }) as WebSpec;

describe('wordDiff', () => {
  it('marks removed words on the left and added words on the right, keeping the rest', () => {
    const { a, b } = wordDiff('warm grey ground, soft shadow', 'warm ochre ground, soft shadow');
    expect(a.filter((t) => t.kind === 'del').map((t) => t.text)).toEqual(['grey']);
    expect(b.filter((t) => t.kind === 'add').map((t) => t.text)).toEqual(['ochre']);
    expect(a.map((t) => t.text).join('')).toBe('warm grey ground, soft shadow');
    expect(b.map((t) => t.text).join('')).toBe('warm ochre ground, soft shadow');
  });

  it('marks the space inside a changed phrase as part of the change', () => {
    const { b } = wordDiff('a b c d', 'a x y d');
    expect(b.map((t) => t.kind)).toEqual(['same', 'same', 'add', 'add', 'add', 'same', 'same']);
  });

  it('treats identical text as unchanged and empty text as wholly added', () => {
    expect(wordDiff('same words', 'same words').b.every((t) => t.kind === 'same')).toBe(true);
    expect(wordDiff('', 'new text').b.map((t) => t.kind)).toEqual(['add', 'add', 'add']);
  });
});

describe('compareSpecs', () => {
  it('groups the note, signature and each dimension, and counts what changed', () => {
    const a = spec();
    const b = spec();
    b.note = 'A different note.';
    b.system.typography = { ...b.system.typography, value: 'condensed grotesque, 800 weight', confidence: 0.9 };

    const groups = compareSpecs(a, b);
    const titles = groups.map((g) => g.title);
    expect(titles[0]).toBe('Note');
    expect(titles).toContain('Signature');
    expect(titles).toContain('Typography');
    expect(titles).toContain('Color system');
    expect(titles).not.toContain('Name');

    const typography = groups.find((g) => g.title === 'Typography')!;
    expect(typography.changed).toBe(2);
    expect(typography.rows.find((r) => r.label === 'Value')).toMatchObject({ changed: true, b: 'condensed grotesque, 800 weight' });
    expect(typography.rows.find((r) => r.label === 'Evidence')?.changed).toBe(false);

    const summary = summarize(groups);
    expect(summary.dimensions).toEqual({ changed: 1, total: 27 });
    expect(summary.rows).toBe(3);
  });

  it('shows lists one item per line and rows present on one side only', () => {
    const a = spec();
    const b = spec();
    b.build = [...a.build, 'Add a sticky header'];
    const groups = compareSpecs(a, b);
    const build = groups.find((g) => g.title === 'Build')!;
    expect(build.rows[0].b?.split('\n').at(-1)).toBe('Add a sticky header');
    expect(build.rows[0].changed).toBe(true);

    delete (b as Partial<WebSpec>).patterns;
    const patterns = compareSpecs(a, b).find((g) => g.title === 'Patterns');
    expect(patterns?.rows.every((row) => row.b === null && row.changed)).toBe(true);
  });
});
