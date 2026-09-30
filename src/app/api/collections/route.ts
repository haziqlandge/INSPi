import type { NextRequest } from 'next/server';
import { crossOrigin, fail, ok, readJson } from '@/lib/http';
import { library } from '@/lib/store';

export async function GET() {
  return ok({ collections: library().listCollections() });
}

export async function POST(request: NextRequest) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const { name } = await readJson(request);
  if (typeof name !== 'string' || !name.trim()) return fail(400, 'Give the collection a name.');
  return ok(library().createCollection(name), { status: 201 });
}
