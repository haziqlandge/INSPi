import { lensById } from '@/lib/ai/prompts/lenses';
import { focusAreas } from '@/lib/ai/prompts/steer';
import type { EntryVersion, Mode } from '@/lib/types';

/** How a version was made, in words: "structure first pass", "guided pass: typography, colour". */
export function passLabel(version: EntryVersion, mode: Mode): string {
  const picked = focusAreas(mode).filter((area) => version.steer?.focus.includes(area.id));
  if (picked.length) return `guided pass: ${picked.map((area) => area.label.toLowerCase()).join(', ')}`;
  const base = `${lensById(version.lens).label.toLowerCase()} pass`;
  return version.steer?.note ? `${base}, with your note` : base;
}
