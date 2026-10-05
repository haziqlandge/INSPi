import { describe, expect, it } from 'vitest';
import { lensForVersion } from '@/lib/ai/prompts/lenses';
import { observePrompt } from '@/lib/ai/prompts/observe';
import { focusAreas, lensForRetry, readSteer, STEER_NOTE_MAX } from '@/lib/ai/prompts/steer';
import { translatePrompt } from '@/lib/ai/prompts/translate';

describe('reading guidance from a request', () => {
  it('keeps known focus areas for the mode, in order, without repeats', () => {
    expect(readSteer('web', { focus: ['colour', 'typography', 'colour', 'nope', 'medium'], note: '' })).toEqual({
      focus: ['colour', 'typography'],
      note: '',
    });
    expect(readSteer('image', { focus: ['medium', 'behaviour'] })?.focus).toEqual(['medium']);
  });

  it('tidies the note and caps its length', () => {
    const note = `  The headline\n\n\nis heavier   ${'x'.repeat(900)}`;
    const steer = readSteer('web', { focus: [], note })!;
    expect(steer.note.startsWith('The headline\nis heavier x')).toBe(true);
    expect(steer.note.length).toBe(STEER_NOTE_MAX);
  });

  it('is null when nothing was asked for', () => {
    expect(readSteer('web', undefined)).toBeNull();
    expect(readSteer('web', { focus: [], note: '   ' })).toBeNull();
    expect(readSteer('web', 'typography')).toBeNull();
  });
});

describe('the lens a retry uses', () => {
  it('follows the usual rotation without guidance or with only a note', () => {
    expect(lensForRetry('web', 3, null).id).toBe(lensForVersion(3).id);
    expect(lensForRetry('web', 3, { focus: [], note: 'warmer' }).id).toBe(lensForVersion(3).id);
  });

  it('turns chosen focus areas into an emphasis on their dimensions', () => {
    const lens = lensForRetry('web', 2, { focus: ['typography', 'colour'], note: '' });
    expect(lens.id).toBe('guided');
    const text = lens.focus('web');
    expect(text).toContain('typography');
    expect(text).toContain('color_system');
    expect(text).not.toContain('lighting');
  });

  it('offers image areas for image entries and web areas for web entries', () => {
    expect(focusAreas('web').map((a) => a.id)).toContain('behaviour');
    expect(focusAreas('web').map((a) => a.id)).not.toContain('medium');
    expect(focusAreas('image').map((a) => a.id)).toContain('medium');
  });
});

describe('the note reaches both passes', () => {
  const steer = { focus: [], note: 'The background is warmer than v1 said' };

  it('asks the observe pass to check the note against the image', () => {
    const { system } = observePrompt({ mode: 'web', frames: 1, collage: false, rubric: 'names', lens: lensForVersion(2), steer });
    expect(system).toContain('The background is warmer than v1 said');
    expect(system).toMatch(/check/i);
  });

  it('asks the translate pass to reflect the note where the observations support it', () => {
    const { system } = translatePrompt({ mode: 'image', digest: 'd', knownTags: [], steer });
    expect(system).toContain('The background is warmer than v1 said');
  });

  it('leaves both prompts alone without a note', () => {
    const plain = observePrompt({ mode: 'web', frames: 1, collage: false, rubric: 'names', lens: lensForVersion(2) });
    expect(plain.system).not.toContain('reviewed the previous version');
  });
});
