import type { NextRequest } from 'next/server';
import { ok } from '@/lib/http';
import { library } from '@/lib/store';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return ok({ items: library().related(id, 8) });
}
