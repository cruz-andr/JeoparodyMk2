import { useEffect, useRef } from 'react';
import { ADSENSE_CLIENT, ADSENSE_SLOT } from '../../config/ads';
import './AdSlot.css';

/* The AdSense script, added once, the first time any slot is drawn. */
let scriptAdded = false;
function loadAdSense() {
  if (scriptAdded || !ADSENSE_CLIENT) return;
  scriptAdded = true;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
  document.head.appendChild(s);
}

/**
 * One ad, on a page between games: the menu, a results screen, Community
 * Boards. Never on a clue, a buzzer or a clock, where an ad would be in the
 * way of play and an accidental tap is a policy problem for the site.
 *
 * Nothing at all until the site has an AdSense id (config/ads.js). The box
 * keeps its height while the ad loads, so the page does not jump.
 */
export default function AdSlot({ className = '' }) {
  const pushed = useRef(false);

  useEffect(() => {
    if (!ADSENSE_CLIENT || !ADSENSE_SLOT || pushed.current) return;
    loadAdSense();
    pushed.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch { /* an ad that cannot be filled leaves an empty box, nothing worse */ }
  }, []);

  if (!ADSENSE_CLIENT || !ADSENSE_SLOT) return null;

  return (
    <aside className={`ad-slot ${className}`} aria-label="Advertisement">
      <span className="ad-slot-label">Advertisement</span>
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={ADSENSE_SLOT}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
