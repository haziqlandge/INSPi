import type { Spec } from '../ai/schema/display';

const WEB = `Rebuild the page described below as one self-contained HTML file (inline CSS, no frameworks), matching it as closely as you can.
- "blueprint" is the page itself: build every section in order, at the stated positions and sizes, and use the visible text exactly as quoted. Do not invent sections, slogans or brand names.
- Draw everything under "assets" yourself with CSS or inline SVG, at the stated counts, offsets, sizes and rotations.
- "system" is the measured style and each "web" field its CSS translation; "tokens" are your design tokens; "build" is the order of work; "avoid" lists hard constraints.
- "signature" is non-negotiable.
- Where confidence is below 0.5, or a value is missing, use judgment.`;

const IMAGE = `Generate an image in the visual style described below, with a subject of your own.
- "signature" is non-negotiable.
- "prompt" is the style in one paragraph; "system" is the measured detail behind it, and each "gen" field is ready-made phrasing.
- "negative" lists what to keep out. "params" suggests format and medium.
- Reproduce the style, not the original subject.
- Where confidence is below 0.5, use judgment.`;

export function specJson(spec: Spec): string {
  return JSON.stringify(spec, null, 2);
}

/** What "Copy prompt" puts on the clipboard: a ready-to-paste instruction followed by the JSON. */
export function composePrompt(spec: Spec): string {
  return `${spec.inspi === 'web/1' ? WEB : IMAGE}\n\n${specJson(spec)}`;
}
