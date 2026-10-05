import type { Spec, SubjectMode } from '../ai/schema/display';

export type { SubjectMode };

const WEB = `Rebuild the page described below as one self-contained HTML file (inline CSS, no frameworks), matching it as closely as you can.
- "blueprint" is the page itself: build every section in order, at the stated positions and sizes, and use the visible text exactly as quoted. Do not invent sections, slogans or brand names.
- Draw everything under "assets" yourself with CSS or inline SVG, at the stated counts, offsets, sizes and rotations.
- "system" is the measured style and each "web" field its CSS translation; "tokens" are your design tokens; "build" is the order of work; "avoid" lists hard constraints.
- "signature" is non-negotiable.
- Where confidence is below 0.5, or a value is missing, use judgment.`;

const WEB_INSPIRE = `Use the reference described below as inspiration for an original website for my project. Carry over its design language, not its identity.
- "keep" lists principles to carry over as they are; "adapt" lists patterns to redesign around my project; "avoid" is a hard list, and never reproduce the reference's logo, brand name, copy or illustrations.
- "signature" defines the look. "patterns.motif" is its signature idea: rebuild it with my project's own subject, as "transform" suggests.
- "patterns.components" are the reference's building blocks with their proportions and styling; use the ones my content needs, in the same spirit.
- "system" is the measured style: each "web" field is its CSS translation, "basis" says whether it was seen or inferred (treat inferred as a suggestion), "priority" says how much it matters.
- "tokens" are your design tokens; "build" is a good order of work.
- Write original copy in the tone "patterns.voice" describes. Where confidence is below 0.5, use judgment.
- My project is described after the JSON. If it is not, ask me what the site is for before building anything.`;

const IMAGE = `Generate an image in the visual style described below, with a subject of your own.
- "signature" is non-negotiable.
- "prompt" is the style in one paragraph; "system" is the measured detail behind it, and each "gen" field is ready-made phrasing.
- "negative" lists what to keep out. "params" suggests format and medium.
- Reproduce the style, not the original subject.
- Where confidence is below 0.5, use judgment.`;

export const SUBJECT_MODES: SubjectMode[] = ['recreate', 'mine', 'model'];

export const SUBJECT_LABELS: Record<SubjectMode, string> = {
  recreate: 'Recreate it',
  mine: 'My subject',
  model: 'Model’s choice',
};

export interface SubjectChoice {
  mode: SubjectMode;
  /** The subject to draw: the reference's own for "recreate", the person's for "mine". */
  text?: string;
}

const RECREATE = (subject: string) => `Recreate the reference image described below as faithfully as you can: the same subject, arrangement and style.
Subject: ${subject}
- Keep the subject as described, in the composition, framing and proportions the "system" findings give.
- "signature" is non-negotiable.
- "prompt" is the style in one paragraph; "system" is the measured detail behind it, and each "gen" field is ready-made phrasing.
- "negative" lists what to keep out. "params" suggests format and medium.
- Where confidence is below 0.5, use judgment.`;

const MINE = (subject: string) => `Generate an image of: ${subject}
Render it in the visual style described below.
- "signature" is non-negotiable.
- "prompt" is the style in one paragraph; "system" is the measured detail behind it, and each "gen" field is ready-made phrasing.
- "negative" lists what to keep out. "params" suggests format and medium.
- The subject is the one above, not the reference's; carry over only how it is rendered, lit, coloured and composed.
- Where confidence is below 0.5, use judgment.`;

/**
 * The person's changes go on the second line, before the subject and the JSON. They used to follow
 * the instruction block, below a long subject that still said "at night", and image models that
 * read only the start of a long prompt never reached them. They also override the subject, not just
 * the JSON, and say what to hold still.
 */
function withChanges(instruction: string, changes: string | undefined): string {
  if (!changes) return instruction;
  const at = instruction.indexOf('\n');
  const line = `Changes from the reference. They override the subject, the JSON and any other detail that conflicts (time of day, weather, light, setting, colours); keep everything else as it is: ${changes}`;
  return at < 0 ? `${instruction}\n${line}` : `${instruction.slice(0, at)}\n${line}${instruction.slice(at)}`;
}

/** INSPi's own bookkeeping, never part of the JSON a model reads. */
const INTERNAL = new Set(['subjectMode', 'mySubject']);

export function specJson(spec: Spec): string {
  return JSON.stringify(spec, (key, value) => (INTERNAL.has(key) ? undefined : value), 2);
}

/** A subject choice sent by the browser; null when it is not a usable one. */
export function readSubjectChoice(mode: unknown, text: unknown): SubjectChoice | null {
  const picked = SUBJECT_MODES.find((m) => m === mode);
  if (!picked) return null;
  const clean = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ').slice(0, 600) : '';
  if (picked === 'mine') return clean ? { mode: picked, text: clean } : null;
  return { mode: picked };
}

/** The choice an entry's prompt makes by default: the one saved on it, else style only. */
export function entrySubject(spec: Spec): SubjectChoice {
  if (spec.inspi !== 'image/1' || !spec.subjectMode) return { mode: 'model' };
  return spec.subjectMode === 'mine' ? { mode: 'mine', text: spec.mySubject } : { mode: spec.subjectMode };
}

/** The spec without the reference's subject, for prompts that should not draw it. */
function withoutSubject(spec: Spec): Spec {
  if (spec.inspi !== 'image/1' || spec.subject === undefined) return spec;
  const { subject: _subject, ...rest } = spec;
  return rest;
}

/**
 * What "Copy prompt" puts on the clipboard: a ready-to-paste instruction followed by the JSON. For an
 * image entry, `subject` decides whether the picture is recreated, given the person's own subject, or
 * left to the model; by default, the choice saved on the entry (style only when there is none).
 */
export function composePrompt(spec: Spec, subject: SubjectChoice = entrySubject(spec)): string {
  const changes = spec.changes?.replace(/\s+/g, ' ').trim();
  if (spec.inspi !== 'image/1') return `${withChanges(spec.inspi === 'web/2' ? WEB_INSPIRE : WEB, changes)}\n\n${specJson(spec)}`;
  const text = subject.text?.trim().replace(/\s+/g, ' ').slice(0, 600);
  if (subject.mode === 'recreate' && (text || spec.subject)) return `${withChanges(RECREATE(text || spec.subject!), changes)}\n\n${specJson(spec)}`;
  if (subject.mode === 'mine' && text) return `${withChanges(MINE(text), changes)}\n\n${specJson(withoutSubject(spec))}`;
  return `${withChanges(IMAGE, changes)}\n\n${specJson(withoutSubject(spec))}`;
}
