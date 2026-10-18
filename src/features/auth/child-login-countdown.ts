import { useCallback, useEffect, useState } from 'react';

/** Seconds left until a lockout ends; ticks once a second and stops at 0. */
export function useCountdown() {
  const [until, setUntil] = useState<number | null>(null);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining === 0) setUntil(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [until]);

  const start = useCallback((seconds: number) => {
    setLeft(seconds);
    setUntil(Date.now() + seconds * 1000);
  }, []);

  return { left, start };
}
