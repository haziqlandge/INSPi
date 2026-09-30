import type { CSSProperties } from 'react';

interface Props {
  className?: string;
  style?: CSSProperties;
  /** Announced to screen readers; leave out for decorative pieces inside a larger placeholder. */
  label?: string;
}

/** A placeholder block with a slow light sweep across it. The sweep is drawn in CSS (`.skeleton`). */
export function Skeleton({ className = '', style, label }: Props) {
  return (
    <div
      className={`skeleton ${className}`}
      style={style}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
