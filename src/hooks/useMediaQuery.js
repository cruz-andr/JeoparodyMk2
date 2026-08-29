import { useEffect, useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

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

    // Safari 13 and older expose only the deprecated addListener. The daily
    // board calls this unconditionally, so throwing here would take the whole
    // page down rather than falling back to the desktop layout.
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    }
    list.addListener(onChange);
    return () => list.removeListener(onChange);
  }, [query]);

  return matches;
}

/**
 * True when the player has asked for less motion.
 *
 * The OS setting is the default, but it is not always reachable or right: a
 * shared machine, a phone where the switch is buried, or someone who wants the
 * motion here and not elsewhere. The in-app setting can force it either way.
 */
export function usePrefersReducedMotion() {
  const fromSystem = useMediaQuery('(prefers-reduced-motion: reduce)');
  const choice = useSettingsStore((s) => s.reduceMotion);
  if (choice === 'on') return true;
  if (choice === 'off') return false;
  return fromSystem;
}

export default useMediaQuery;
