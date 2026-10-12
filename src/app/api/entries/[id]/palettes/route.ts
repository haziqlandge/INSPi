import type { NextRequest } from 'next/server';
import { crossOrigin, fail, ok } from '@/lib/http';
import { library } from '@/lib/store';

const HEX = /^#[0-9a-f]{6}$/i;

/** Keeps a rolled palette on the entry. Body: `{ colors: string[] }`. Returns every saved palette. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const { id } = await params;
  const lib = library();
  if (!lib.getEntry(id)) return fail(404, 'That entry does not exist.');
  const body = (await request.json().catch(() => null)) as { colors?: unknown } | null;
  const colors = Array.isArray(body?.colors) ? body.colors : [];
  if (!colors.length || colors.length > 7 || !colors.every((c) => typeof c === 'string' && HEX.test(c))) {
    return fail(400, 'Send one to seven colours as #rrggbb.');
  }
  return ok({ palettes: lib.savePalette(id, (colors as string[]).map((c) => c.toLowerCase())) });
}

/** Removes one saved palette: `?palette=<id>`. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const { id } = await params;
  const lib = library();
  if (!lib.getEntry(id)) return fail(404, 'That entry does not exist.');
  const paletteId = request.nextUrl.searchParams.get('palette') ?? '';
  return ok({ palettes: lib.deletePalette(id, paletteId) });
}
