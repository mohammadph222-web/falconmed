import { useEffect, useRef, useState } from "react";

function easeOutQuart(t) {
  return 1 - Math.pow(1 - t, 4);
}

/**
 * Animates a numeric value from 0 → target over `duration` ms.
 * Re-runs the animation whenever `target` changes.
 *
 * @param {number} target   - The destination value to count up to.
 * @param {number} duration - Animation duration in ms (default 1000).
 * @returns {number}        - The current animated value (integer-rounded when target is an integer).
 */
export function useAnimatedCounter(target, duration = 1000) {
  const [count, setCount] = useState(0);
  const frameRef = useRef(null);

  useEffect(() => {
    const numTarget = Number(target);

    if (!Number.isFinite(numTarget)) {
      setCount(0);
      return;
    }

    const isInt = Number.isInteger(numTarget);
    let startTime = null;

    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;

      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutQuart(progress);
      const current = numTarget * eased; // always starts from 0

      setCount(isInt ? Math.round(current) : current);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        setCount(numTarget);
      }
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration]);

  return count;
}
