import type { PaletteSwatch } from '@/lib/types';

/**
 * The measured colours as a row of circles under the image. Clicking a circle copies its hex
 * (hovering shows the hex and share); the label beside them opens the palette sheet.
 */
export function PaletteDots({
  palette,
  kept,
  onOpen,
  onCopy,
}: {
  palette: PaletteSwatch[];
  kept: number;
  onOpen: () => void;
  onCopy: (hex: string) => void;
}) {
  return (
    <div className="group mt-4 flex items-center gap-3 py-1 pl-1">
      <span className="flex items-center">
        {palette.map((swatch, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onCopy(swatch.hex)}
            title={`Copy ${swatch.hex} · ${Math.round(swatch.share * 100)}%`}
            aria-label={`Copy ${swatch.hex}`}
            className="-ml-1.5 h-8 w-8 cursor-copy rounded-full border border-line ring-2 ring-paper transition-transform duration-300 first:ml-0 hover:z-10 hover:-translate-y-1 hover:scale-110 focus-visible:z-10 active:scale-95 sm:h-9 sm:w-9"
            style={{ background: swatch.hex }}
          />
        ))}
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="rounded-full px-1 text-[0.8125rem] text-muted underline decoration-line underline-offset-4 transition-colors hover:text-head hover:decoration-accent"
        aria-label="Open the palette: measured colours, lock and roll"
      >
        Palette{kept ? ` · ${kept} kept` : ''}
      </button>
    </div>
  );
}

/**
 * The measured colours as one bar, each segment as wide as its share of the image. With `onCopy`,
 * clicking a segment copies its hex.
 */
export function PaletteBar({ palette, className = '', onCopy }: { palette: PaletteSwatch[]; className?: string; onCopy?: (hex: string) => void }) {
  if (!onCopy) {
    return (
      <span className={`flex overflow-hidden rounded-full ${className}`} aria-hidden>
        {palette.map((swatch, i) => (
          // Very small shares still get a sliver so every colour is visible.
          <span key={i} style={{ background: swatch.hex, flexGrow: Math.max(swatch.share, 0.04) }} />
        ))}
      </span>
    );
  }
  return (
    <span className={`flex overflow-hidden rounded-full ${className}`}>
      {palette.map((swatch, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onCopy(swatch.hex)}
          title={`Copy ${swatch.hex} · ${Math.round(swatch.share * 100)}%`}
          aria-label={`Copy ${swatch.hex}`}
          className="cursor-copy transition-[filter] hover:brightness-110 focus-visible:relative focus-visible:z-10"
          style={{ background: swatch.hex, flexGrow: Math.max(swatch.share, 0.04) }}
        />
      ))}
    </span>
  );
}
