import { rollHarmony } from '@/lib/palette/harmony';
import type { SavedPalette } from '@/lib/types';
import { api } from './api';

export type RollEngine = 'harmony' | 'colormind';

/** Harmony runs right here; Colormind goes through the server (it only answers over http). */
export async function roll(engine: RollEngine, colors: string[], locked: boolean[]): Promise<string[]> {
  if (engine === 'harmony') return rollHarmony(colors, locked);
  return (await api<{ colors: string[] }>('/api/palette/roll', { method: 'POST', json: { engine, colors, locked } })).colors;
}

export async function savePalette(entryId: string, colors: string[]): Promise<SavedPalette[]> {
  return (await api<{ palettes: SavedPalette[] }>(`/api/entries/${entryId}/palettes`, { method: 'POST', json: { colors } })).palettes;
}

export async function deletePalette(entryId: string, paletteId: string): Promise<SavedPalette[]> {
  return (await api<{ palettes: SavedPalette[] }>(`/api/entries/${entryId}/palettes?palette=${encodeURIComponent(paletteId)}`, { method: 'DELETE' }))
    .palettes;
}

export function asCssVariables(colors: string[]): string {
  return `:root {\n${colors.map((c, i) => `  --c${i + 1}: ${c};`).join('\n')}\n}`;
}
