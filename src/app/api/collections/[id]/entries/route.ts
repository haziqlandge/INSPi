import type { NextRequest } from 'next/server';
import { crossOrigin, fail, ok, readJson } from '@/lib/http';
import { library } from '@/lib/store';

type Context = { params: Promise<{ id: string }> };

async function target(request: NextRequest, { params }: Context) {
  const { id } = await params;
  const { entryId } = await readJson(request);
  const lib = library();
  if (typeof entryId !== 'string' || !lib.getCollection(id) || !lib.getEntry(entryId)) return null;
  return { lib, collectionId: id, entryId };
}

export async function POST(request: NextRequest, context: Context) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const t = await target(request, context);
  if (!t) return fail(404, 'That collection or entry does not exist.');
  t.lib.addToCollection(t.collectionId, t.entryId);
  return ok(t.lib.getCollection(t.collectionId));
}

export async function DELETE(request: NextRequest, context: Context) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const t = await target(request, context);
  if (!t) return fail(404, 'That collection or entry does not exist.');
  t.lib.removeFromCollection(t.collectionId, t.entryId);
  return ok(t.lib.getCollection(t.collectionId));
}
