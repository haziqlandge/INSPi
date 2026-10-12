/**
 * "Roll" through Colormind (colormind.io), a free model trained on real palettes. It fills five
 * slots per call, with locked colours sent as RGB and open ones as "N", so seven colours take two
 * calls: slots 1–5, then slots 6–7 with the first answer's opening three held as context.
 * Server-side only: Colormind answers over plain http.
 */

type Slot = [number, number, number] | 'N';
interface Body {
  model: 'default';
  input: Slot[];
}

const URL = 'http://colormind.io/api/';
const TIMEOUT_MS = 10_000;

const rgb = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hex = ([r, g, b]: number[]) => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

export function colormindBody(colors: string[], locked: boolean[]): { first: Body; second: (firstResult: string[]) => Body } {
  const slot = (i: number): Slot => (locked[i] ? rgb(colors[i]) : 'N');
  return {
    first: { model: 'default', input: [0, 1, 2, 3, 4].map(slot) },
    second: (firstResult) => ({ model: 'default', input: [rgb(firstResult[0]), rgb(firstResult[1]), rgb(firstResult[2]), slot(5), slot(6)] }),
  };
}

async function ask(body: Body, fetchImpl: typeof fetch): Promise<string[]> {
  let response: Response;
  try {
    response = await fetchImpl(URL, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Error('Colormind did not answer.');
  }
  const payload = (await response.json().catch(() => null)) as { result?: number[][] } | null;
  if (!response.ok || !Array.isArray(payload?.result) || payload.result.length < 5) throw new Error('Colormind did not answer.');
  return payload.result.map(hex);
}

export async function rollColormind(colors: string[], locked: boolean[], fetchImpl: typeof fetch = fetch): Promise<string[]> {
  if (locked.every(Boolean)) return [...colors];
  const { first, second } = colormindBody(colors, locked);
  const a = await ask(first, fetchImpl);
  const b = await ask(second(a), fetchImpl);
  const answer = [...a, b[3], b[4]];
  // Colormind can nudge a locked colour by a shade; locked means exactly as it was.
  return colors.map((original, i) => (locked[i] ? original : answer[i]));
}
