/**
 * Width and height for an aspect ratio such as "3:2", with the long side at `long` and both sides
 * in multiples of 16 (some Pollinations models require it). Anything unreadable becomes a square.
 */
export function sizeFor(aspect: string | undefined, long = 1024): { width: number; height: number } {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/i.exec(aspect ?? '');
  const w = match ? Number(match[1]) : 0;
  const h = match ? Number(match[2]) : 0;
  if (!(w > 0 && h > 0)) return { width: long, height: long };
  const snap = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  return w >= h ? { width: long, height: snap((long * h) / w) } : { width: snap((long * w) / h), height: long };
}
