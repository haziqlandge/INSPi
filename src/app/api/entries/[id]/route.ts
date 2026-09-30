import type { NextRequest } from 'next/server';
import { crossOrigin, fail, ok, readJson } from '@/lib/http';
import { ensureWorker } from '@/lib/jobs/worker';
import { library } from '@/lib/store';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  ensureWorker();
  const { id } = await params;
  const entry = library().getEntry(id);
  return entry ? ok(entry) : fail(404, 'That entry does not exist.');
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const { id } = await params;
  const body = await readJson(request);
  try {
    const entry = library().updateEntry(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      category: typeof body.category === 'string' ? body.category : undefined,
      tags: body.tags,
      favorite: typeof body.favorite === 'boolean' ? body.favorite : undefined,
      activeVersionId: typeof body.activeVersionId === 'string' ? body.activeVersionId : undefined,
    });
    return entry ? ok(entry) : fail(404, 'That entry does not exist.');
  } catch (error) {
    return fail(400, error instanceof Error ? error.message : 'That change could not be saved.');
  }
}

/** Deletion is soft for a few minutes so it can be undone; the worker removes the files later. */
export async function DELETE(request: NextRequest, { params }: Context) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const { id } = await params;
  library().softDelete(id);
  return ok({ deleted: id });
}
