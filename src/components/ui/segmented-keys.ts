/** Where an arrow key (or Home / End) moves a segmented switch's choice; null for any other key. Wraps at the ends. */
export function arrowTarget<T extends string>(values: readonly T[], current: T, key: string): T | null {
  const at = values.indexOf(current);
  if (key === 'ArrowRight' || key === 'ArrowDown') return values[(at + 1) % values.length];
  if (key === 'ArrowLeft' || key === 'ArrowUp') return values[(at - 1 + values.length) % values.length];
  if (key === 'Home') return values[0];
  if (key === 'End') return values[values.length - 1];
  return null;
}
