/**
 * One tab title per screen.
 *
 * Every page used to share the single "Jeoparody!" from index.html, so five
 * open tabs read the same and a shared link previewed as nothing in
 * particular. Each page now names itself the way its own header does, and the
 * name is put back when the page unmounts so a screen that sets nothing does
 * not inherit the last one's.
 */
import { useEffect } from 'react';

export const SITE_NAME = 'Jeoparody';

/**
 * "<Page> · Jeoparody", or just "Jeoparody" for the menu and anything that
 * names itself after the site. Pure, so it can be checked without a browser.
 */
export function formatPageTitle(name) {
  const page = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (!page) return SITE_NAME;
  if (page.replace(/!$/, '').toLowerCase() === SITE_NAME.toLowerCase()) return SITE_NAME;
  if (page.endsWith(` · ${SITE_NAME}`)) return page;
  return `${page} · ${SITE_NAME}`;
}

export function usePageTitle(name) {
  useEffect(() => {
    const previous = document.title;
    document.title = formatPageTitle(name);
    return () => { document.title = previous; };
  }, [name]);
}

export default usePageTitle;
