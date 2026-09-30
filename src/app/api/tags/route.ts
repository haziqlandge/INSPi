import { ok } from '@/lib/http';
import { groupOfTag } from '@/lib/library/vocabulary';
import { library } from '@/lib/store';

/** Every tag in use, most used first, with the vocabulary group it belongs to. */
export async function GET() {
  return ok({ tags: library().allTags().map((tag) => ({ ...tag, group: groupOfTag(tag.name) })) });
}
