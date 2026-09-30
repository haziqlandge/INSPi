import type { NextRequest } from 'next/server';
import { ok } from '@/lib/http';
import { library } from '@/lib/store';

/** Random entries in an order fixed by `seed`, so paging does not repeat or skip any. */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(p.get('limit')) || 12, 1), 48);
  const items = library().discover({
    exclude: (p.get('exclude') ?? '').split(',').filter(Boolean).slice(0, 50),
    limit: limit + 1,
    offset: Math.max(Number(p.get('offset')) || 0, 0),
    seed: Number(p.get('seed')) || 1,
  });
  return ok({ items: items.slice(0, limit), more: items.length > limit });
}
