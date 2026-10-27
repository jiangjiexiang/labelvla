import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/** Container width (px) below which the episode sidebar stacks under the player. */
export const STACKED_LAYOUT_MAX_WIDTH_PX = 640;

export function isStackedLayoutWidth(width: number): boolean {
  return Number.isFinite(width) && width > 0 && width < STACKED_LAYOUT_MAX_WIDTH_PX;
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * True while the observed container is narrower than 640px. Measured in a
 * layout effect so the first paint already uses the right layout, then kept in
 * sync with a ResizeObserver (disconnected on unmount).
 */
export function useStackedLayout(ref: RefObject<HTMLElement | null>): boolean {
  const [stacked, setStacked] = useState(false);
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setStacked(isStackedLayoutWidth(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setStacked(isStackedLayoutWidth(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return stacked;
}
