import type { NextRequest } from 'next/server';
import { crossOrigin, fail, ok } from '@/lib/http';
import { REMOVED_MESSAGE, removedImageModels } from '@/lib/imagine/removed';
import { readImagineBody, runImagine } from '@/lib/imagine/run';
import { ImagineError, isBackendId } from '@/lib/imagine/types';
import { library } from '@/lib/store';

const PAGE = 40;

/** Renders, newest first: `?entryId=` for one entry's, `?backend=` to filter, `?offset=` to page. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const backend = params.get('backend');
  const items = library().listRenders({
    entryId: params.get('entryId') || undefined,
    backend: isBackendId(backend) ? backend : undefined,
    limit: PAGE,
    offset: Math.max(0, Number(params.get('offset')) || 0),
  });
  return ok({ items, pageSize: PAGE });
}

/** Generates one image with the backend and model given. Only that one is tried. */
export async function POST(request: NextRequest) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const input = readImagineBody(await request.json().catch(() => null));
  if ('error' in input) return fail(400, input.error);
  if (removedImageModels(library()).has(input.model)) return fail(400, REMOVED_MESSAGE);
  if (input.entryId && !library().getEntry(input.entryId)) return fail(404, 'That entry does not exist.');
  try {
    return ok(await runImagine(input));
  } catch (error) {
    if (error instanceof ImagineError) return fail(502, error.message);
    return fail(500, error instanceof Error ? error.message : 'The image could not be made.');
  }
}
