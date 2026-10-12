import type { NextRequest } from 'next/server';
import { crossOrigin, fail, ok } from '@/lib/http';
import { rollColormind } from '@/lib/palette/colormind';
import { rollHarmony } from '@/lib/palette/harmony';

const HEX = /^#[0-9a-f]{6}$/i;

/** Rolls the unlocked colours of a palette. Colormind needs the server (it answers over plain http). */
export async function POST(request: NextRequest) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const body = (await request.json().catch(() => null)) as { engine?: unknown; colors?: unknown; locked?: unknown } | null;
  const colors = Array.isArray(body?.colors) ? body.colors : [];
  const locked = Array.isArray(body?.locked) ? body.locked : [];
  if (!colors.length || colors.length > 7 || !colors.every((c) => typeof c === 'string' && HEX.test(c))) {
    return fail(400, 'Send one to seven colours as #rrggbb.');
  }
  if (locked.length !== colors.length || !locked.every((l) => typeof l === 'boolean')) return fail(400, 'Say which colours are locked.');
  const hexes = (colors as string[]).map((c) => c.toLowerCase());

  if (body?.engine === 'harmony') return ok({ colors: rollHarmony(hexes, locked as boolean[]) });
  if (body?.engine !== 'colormind') return fail(400, 'Unknown roll engine.');
  try {
    return ok({ colors: await rollColormind(hexes, locked as boolean[]) });
  } catch (error) {
    return fail(502, error instanceof Error ? error.message : 'Colormind did not answer.');
  }
}
