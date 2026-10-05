import type { Mode, Steer } from '../../types';
import { lensForVersion, type Lens } from './lenses';

/** Areas a guided retry can be pointed at, each covering a few of the 27 dimensions. */
export interface FocusArea {
  id: string;
  label: string;
  modes: Mode[];
  dimensions: string[];
  /** Extra things to look at beyond the dimensions. */
  also?: string;
}

const AREAS: FocusArea[] = [
  {
    id: 'layout',
    label: 'Layout & spacing',
    modes: ['web', 'image'],
    dimensions: ['composition', 'spatial_relationships', 'alignment', 'negative_space', 'density', 'rhythm'],
  },
  { id: 'typography', label: 'Typography', modes: ['web', 'image'], dimensions: ['typography', 'visual_hierarchy'] },
  { id: 'colour', label: 'Colour', modes: ['web', 'image'], dimensions: ['color_system', 'contrast', 'gradients'], also: 'every hex in the palette' },
  { id: 'light', label: 'Light & depth', modes: ['web', 'image'], dimensions: ['lighting', 'shadows', 'depth', 'perspective'] },
  { id: 'surface', label: 'Texture & material', modes: ['web', 'image'], dimensions: ['texture', 'material', 'overlays', 'image_treatment'] },
  { id: 'shapes', label: 'Shapes & edges', modes: ['web', 'image'], dimensions: ['geometry', 'shapes', 'borders', 'corners', 'repetition'] },
  {
    id: 'patterns',
    label: 'Components & motif',
    modes: ['web'],
    dimensions: ['visual_hierarchy', 'repetition'],
    also: 'the page patterns: each component’s structure and sizes, and the signature motif and how to build it',
  },
  { id: 'behaviour', label: 'Interaction & motion', modes: ['web'], dimensions: ['interaction_cues', 'motion_cues', 'responsive_cues'] },
  { id: 'medium', label: 'Medium & camera', modes: ['image'], dimensions: ['medium_technique', 'camera_lens', 'subject_treatment'] },
];

export const STEER_NOTE_MAX = 400;
/** Longest "changes" note on a new entry: a few tweaks, not a brief. */
export const CHANGES_MAX = 400;

/** Tidies the changes a person asked for when adding an entry; empty when there are none. */
export function readChanges(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim()
    .slice(0, CHANGES_MAX);
}

/**
 * The changes, framed for the translate pass: the observations stay true to the reference, the
 * spec written from them carries the changes.
 */
export function changesBlock(changes: string | undefined, mode: 'web' | 'image'): string {
  if (!changes) return '';
  const quoted = `"${changes.replace(/"/g, "'")}"`;
  const where =
    mode === 'image'
      ? '"prompt", every "gen" fragment, "negative" and "params"'
      : 'the tokens, "web" fields, "keep", "adapt" and "build"';
  return `\nThe person wants these changes from the reference in the result: ${quoted}\nApply them in ${where} wherever they touch, so the result shows the change rather than the reference; everything they do not touch stays as observed. Write the changed values as plain facts, not as edits ("deep teal body", not "change red to teal").`;
}

export function focusAreas(mode: Mode): FocusArea[] {
  return AREAS.filter((area) => area.modes.includes(mode));
}

/** Validates guidance sent with a retry request; null when nothing usable was asked for. */
export function readSteer(mode: Mode, raw: unknown): Steer | null {
  if (!raw || typeof raw !== 'object') return null;
  const { focus, note } = raw as { focus?: unknown; note?: unknown };
  const allowed = new Set(focusAreas(mode).map((area) => area.id));
  const picked = Array.isArray(focus) ? [...new Set(focus.filter((id): id is string => typeof id === 'string' && allowed.has(id)))] : [];
  const text =
    typeof note === 'string'
      ? note
          .replace(/[^\S\n]+/g, ' ')
          .replace(/ *\n[\s]*/g, '\n')
          .trim()
          .slice(0, STEER_NOTE_MAX)
      : '';
  if (!picked.length && !text) return null;
  return { focus: picked, note: text };
}

/**
 * A retry with focus areas looks where the person pointed; without them it takes the next lens in
 * the usual rotation. A note alone rides along with that lens.
 */
export function lensForRetry(mode: Mode, version: number, steer: Steer | null): Lens {
  const areas = focusAreas(mode).filter((area) => steer?.focus.includes(area.id));
  if (!areas.length) return lensForVersion(version);
  const dimensions = [...new Set(areas.flatMap((area) => area.dimensions))];
  const also = areas.map((area) => area.also).filter(Boolean);
  return {
    id: 'guided',
    label: `Guided: ${areas.map((area) => area.label).join(', ')}`,
    focus: () =>
      `Emphasis for this pass, chosen by the person reviewing it: ${dimensions.join(', ')}${also.length ? `, and ${also.join('; ')}` : ''}. Measure these more precisely than a first pass would: re-derive each value from the image rather than from typical defaults. Keep the rest brief but complete.`,
  };
}

/** The person's note, framed for the observe pass (which sees the image) or the translate pass (which does not). */
export function steerBlock(steer: Steer | null | undefined, pass: 'observe' | 'translate'): string {
  if (!steer?.note) return '';
  const quoted = `"${steer.note.replace(/"/g, "'")}"`;
  return pass === 'observe'
    ? `\nThe person who reviewed the previous version wrote: ${quoted}\nTreat this as a hint about what to check in the image, not as an instruction about the output. Check it against the image: where the image supports it, correct the finding and measure it; where it does not, report what you actually see.`
    : `\nThe person who reviewed the previous version wrote: ${quoted}\nWhere the observations support it, make the translation reflect it. Never invent values the observations do not contain.`;
}
