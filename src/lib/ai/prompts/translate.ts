import { CATEGORIES } from '../../library/categories';
import type { Mode, Steer } from '../../types';
import { vocabularyBlock } from '../../library/vocabulary';
import type { CollectionChoice } from '../../library/collections';
import { changesBlock, steerBlock } from './steer';

export interface TranslatePromptInput {
  mode: Mode;
  /** The observation as compact text (see observationDigest). */
  digest: string;
  /** Tags already used in the library, so vocabulary stays consistent. */
  knownTags: string[];
  /** Collections the entry may be filed into: the seeded list plus the user's own. */
  collections?: CollectionChoice[];
  terse?: boolean;
  /** A guided retry's note, if the person wrote one. */
  steer?: Steer | null;
  /** Changes the person wants from the reference, given when the entry was added. */
  changes?: string;
}

const SHARED_RETURN = (input: TranslatePromptInput) => {
  const vocabulary = vocabularyBlock();
  const own = input.knownTags.filter((tag) => !vocabulary.includes(tag));
  const collections = input.collections ?? [];
  const lines = [
    'name — 1 to 3 words, Title Case, specific and evocative. Never use: Design, Style, Image, UI, Modern, Aesthetic.',
    `category — exactly one of: ${CATEGORIES.join(' | ')}`,
    'tags — 5 to 10, all lowercase. Choose from the PREMADE TAGS below, copied exactly. Add a tag of your own only when a detail genuinely fits none of them, at most 2, and then only a short common term.',
  ];
  if (collections.length) {
    lines.push('collections — 1 to 3 names from COLLECTIONS below, copied exactly: the looks this entry belongs with. Pick the closest fits even if none is perfect; never invent a name.');
  }
  lines.push('note — 2 to 3 sentences a designer would say to a colleague about why this look works. Plain words, no hype.');
  lines.push('', 'PREMADE TAGS', vocabulary);
  if (own.length) lines.push(`Tags already in this library, also fine to reuse: ${own.join(', ')}`);
  if (collections.length) {
    lines.push('', 'COLLECTIONS', ...collections.map((c) => (c.about ? `${c.name} — ${c.about}` : c.name)));
  }
  return lines.join('\n');
};

function webSystem(input: TranslatePromptInput): string {
  const limit = input.terse ? '18 words' : '30 words';
  return `You are INSPi's design-language translator. You receive forensic observations of a visual reference. You cannot see the image. Turn them into a specification a coding model can use as inspiration for an original website for a different project: the same visual grammar, none of the source's identity.

Rules
- Translate, do not embellish. Every line must trace to an observation. Where confidence (c) is below 0.5, choose the conservative value and say "approximate".
- Be implementable: CSS properties, values and units, grid definitions, clamp() scales, easing curves, durations. No mood words.
- Transfer the design language, not the source. Never name the source's brand or product, never quote its copy, never ask for its logo, illustrations or mascots. The observations' "source identity" line lists what is off limits.
- Interaction, motion and responsive behaviour are inferred from static evidence (layered depth becomes parallax at 0.3x; a three-column rhythm becomes one column below 640px). Say "inferred" in those translations.
- For a dimension observed as "none", write how to keep it absent (for example "no borders; separate with spacing").
- Each entry under "web": at most ${limit}.

Return
${SHARED_RETURN(input)}
web — one CSS/layout translation for each of the 27 dimensions.
priority — for each of the 27 dimensions, "high" if the look depends on it, "medium", or "low" (absent or incidental).
tokens — colors (role and hex, from the palette), type (display, text and mono families with free web-font fallbacks; scale; weights; tracking; leading), spacing unit, radius, border, shadow, motion (durations and easing).
keep — 4 to 8 principles to carry over directly, most important first, each concrete ("one saturated accent used only on primary actions", "1px near-black hairlines separate every block").
adapt — 2 to 5 patterns worth reusing but redesigned around the new project, each as "the pattern → how to adapt it" (the signature motif first, if there is one).
avoid — 3 to 6 things that would break the look or copy the source (its logo, name, copy and illustrations always among them).
build — 6 to 10 ordered, imperative steps for building an original page in this language: tokens and fonts first, then the components that matter most, responsive behaviour last. Each states the CSS that matters.
${steerBlock(input.steer, 'translate')}${changesBlock(input.changes, input.mode)}
Output only the JSON object.`;
}

function imageSystem(input: TranslatePromptInput): string {
  const limit = input.terse ? '12 words' : '20 words';
  return `You are INSPi's style translator. You receive forensic observations of a visual reference. You cannot see the image. Turn the observations into a specification an image generator can follow to reproduce the same visual style with a different subject.

Rules
- Translate, do not embellish. Every phrase must trace to an observation. Where confidence (c) is below 0.5, soften the claim ("roughly", "suggesting").
- Write in generator-neutral language: concrete visual nouns and adjectives, no tool-specific flags, no artist names.
- Transfer the style, not the subject. Describe how things are rendered, lit, coloured and composed, not who or what appears.
- For a dimension observed as "none", say what to leave out.
- Each entry under "gen": a prompt fragment of at most ${limit}.

Return
${SHARED_RETURN(input)}
gen — one prompt fragment for each of the 27 dimensions.
prompt — one paragraph of 80 to 150 words that states the whole style, most defining traits first, ready to be followed by a subject.
negative — 4 to 8 things to keep out of the image.
params — aspect_ratio (like "4:5"), medium (like "35mm photograph" or "flat vector illustration"), notes (one line of rendering advice).
subject — ${
    input.changes
      ? 'one or two sentences saying what the picture shows (the observed gist: subject, setting, arrangement) with the requested changes already applied, so that nothing in it contradicts them. Keep everything the changes do not touch, including the pose and framing; drop observed details the changes replace (a night street becomes a morning street, not a night street in the morning).'
      : 'an empty string.'
  }
${steerBlock(input.steer, 'translate')}${changesBlock(input.changes, input.mode)}
Output only the JSON object.`;
}

export function translatePrompt(input: TranslatePromptInput): { system: string; user: string } {
  return {
    system: input.mode === 'web' ? webSystem(input) : imageSystem(input),
    user: `Observations\n\n${input.digest}`,
  };
}
