import { useState, useEffect } from 'react';

// For the handful of Recharts category-axis charts whose label column needs
// a fixed pixel width — CSS breakpoints can't reach into chart props, so
// this is the escape hatch. Not a general-purpose responsive hook; most of
// the app just uses Tailwind's `lg:`/`sm:` classes.
export function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < breakpoint
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);

  return isMobile;
}
