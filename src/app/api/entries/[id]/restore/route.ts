import type { NextRequest } from 'next/server';
import { crossOrigin, fail, ok } from '@/lib/http';
import { library } from '@/lib/store';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const { id } = await params;
  const lib = library();
  lib.restore(id);
  const entry = lib.getEntry(id);
  return entry ? ok(entry) : fail(404, 'That entry can no longer be restored.');
}
