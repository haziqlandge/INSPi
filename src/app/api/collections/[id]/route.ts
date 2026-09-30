import type { NextRequest } from 'next/server';
import { crossOrigin, fail, ok, readJson } from '@/lib/http';
import { library } from '@/lib/store';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const { id } = await params;
  const { name } = await readJson(request);
  if (typeof name !== 'string' || !name.trim()) return fail(400, 'Give the collection a name.');
  const collection = library().renameCollection(id, name);
  return collection ? ok(collection) : fail(404, 'That collection does not exist.');
}

/** Removes the collection only; its entries stay in the library. */
export async function DELETE(request: NextRequest, { params }: Context) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const { id } = await params;
  library().deleteCollection(id);
  return ok({ deleted: id });
}
