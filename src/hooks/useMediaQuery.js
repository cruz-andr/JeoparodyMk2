import { useEffect, useState } from 'react';

/**
 * Subscribes to a media query.
 *
 * Used where the two layouts are different components rather than the same
 * markup restyled, so CSS alone cannot pick between them.
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const list = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);

    // read once on mount too: the query can differ from the initial render
    // after a rotation or a resize during hydration
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** True when the user has asked for less motion. */
export function usePrefersReducedMotion() {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

export default useMediaQuery;
