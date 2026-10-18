/** Where a popover sits beside its button so it never leaves the screen. Plain arithmetic, tested without a browser. */

export interface Placement {
  top: number;
  left: number;
  width: number;
  /** The panel scrolls inside past this. */
  maxHeight: number;
  side: 'above' | 'below';
}

const GAP = 8;
const MARGIN = 16;

/**
 * Below the button when the panel fits there, else above when it fits there, else on the roomier
 * side, capped to the room. Aligned to the button's left edge, shifted to stay `MARGIN` inside the
 * screen, and never wider than the screen allows.
 */
export function placePopover(
  anchor: { left: number; top: number; right: number; bottom: number },
  panel: { width: number; height: number },
  view: { width: number; height: number },
): Placement {
  const width = Math.min(panel.width, view.width - 2 * MARGIN);
  const left = Math.max(MARGIN, Math.min(anchor.left, view.width - MARGIN - width));
  const below = view.height - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  const side = panel.height <= below || (panel.height > above && below >= above) ? 'below' : 'above';
  const maxHeight = side === 'below' ? below : above;
  const height = Math.min(panel.height, maxHeight);
  const top = side === 'below' ? anchor.bottom + GAP : anchor.top - GAP - height;
  return { top, left, width, maxHeight, side };
}
