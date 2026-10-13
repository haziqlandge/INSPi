import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';
import { crossOrigin, fail, ok } from '@/lib/http';
import { entryMediaDir } from '@/lib/paths';
import { library } from '@/lib/store';
import { PLAYGROUND_DIR } from '@/lib/store/library';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const { id } = await params;
  const removed = library().deleteRender(id);
  if (!removed) return fail(404, 'That image is already gone.');
  await rm(join(entryMediaDir(removed.entryId ?? PLAYGROUND_DIR), removed.file), { force: true }).catch(() => {});
  return ok({ id });
}
