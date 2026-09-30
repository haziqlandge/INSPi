'use client';

import { useEffect, useState } from 'react';

/** "0:41" until the given time, ticking once a second; null when there is nothing to wait for. */
export function useCountdown(until: number | null): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!until) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [until]);

  if (!until) return null;
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
