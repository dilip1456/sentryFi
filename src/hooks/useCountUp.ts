import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from its previous value to `target` over `duration` ms.
 * Uses an ease-out cubic curve for a snappy-then-settling feel.
 * Returns the current animated value (a raw number — format it yourself).
 */
export const useCountUp = (target: number, duration = 1100): number => {
  const [value, setValue] = useState(0);
  const fromRef   = useRef(0);
  const frameRef  = useRef<number | null>(null);
  const startRef  = useRef<number | null>(null);
  const targetRef = useRef(target);

  useEffect(() => {
    // Only animate if the target actually changed (compare against previous ref value)
    if (targetRef.current === target && Math.round(value) === Math.round(target)) return;
    const from = value;
    fromRef.current = from;
    targetRef.current = target;
    startRef.current = null;

    if (frameRef.current) cancelAnimationFrame(frameRef.current);

    const animate = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const elapsed  = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic: starts fast, decelerates to final value
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + (target - from) * eased);
      if (progress < 1) frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return value;
};
