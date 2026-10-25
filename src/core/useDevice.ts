import { useSyncExternalStore } from "react";

/** Breakpoints shared by all UI: phone < 730px wide, tablet < 1100px, or any touch-only device. */
const query = () => ({
  isMobile: window.innerWidth < 730 || (window.innerHeight < 500 && window.innerWidth < 1000),
  isTablet: window.innerWidth >= 730 && window.innerWidth < 1100,
  isTouch: window.matchMedia("(pointer: coarse)").matches,
});

let cached = query();
const subscribe = (cb: () => void) => {
  const update = () => {
    const next = query();
    if (next.isMobile !== cached.isMobile || next.isTablet !== cached.isTablet || next.isTouch !== cached.isTouch) {
      cached = next;
      cb();
    }
  };
  window.addEventListener("resize", update);
  return () => window.removeEventListener("resize", update);
};

export const useDevice = () => useSyncExternalStore(subscribe, () => cached);
export const getDevice = () => cached;
