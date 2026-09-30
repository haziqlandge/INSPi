import { readFile } from 'node:fs/promises';
import type { NextRequest } from 'next/server';
import { safeMediaPath } from '@/lib/paths';

/** Serves stored images. File names contain a random id, so they can be cached forever. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const file = path.length === 2 && path[1].endsWith('.webp') ? safeMediaPath(path) : null;
  if (!file) return new Response('Not found', { status: 404 });
  try {
    const body = await readFile(file);
    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': 'image/webp',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
