import { ok } from '@/lib/http';
import type { ImageSpec } from '@/lib/ai/schema/display';
import { library } from '@/lib/store';

/** Opening lines of the library's own image prompts, for the playground's typing placeholder. */
export async function GET() {
  const lib = library();
  const examples = lib
    .listEntries({ mode: 'image', limit: 12 })
    .items.filter((card) => card.hasPrompt)
    .map((card) => {
      const entry = lib.getEntry(card.id);
      const version = entry?.versions.find((v) => v.id === entry.activeVersionId);
      if (!version || version.spec.inspi !== 'image/1') return null;
      const prompt = (version.spec as ImageSpec).prompt.trim();
      const firstSentence = prompt.split(/(?<=[.!?])\s/)[0] ?? prompt;
      return firstSentence.length > 140 ? `${firstSentence.slice(0, 137).trimEnd()}…` : firstSentence;
    })
    .filter((line): line is string => Boolean(line));
  return ok({ examples });
}
