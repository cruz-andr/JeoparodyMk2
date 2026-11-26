/**
 * Google AdSense, read from the build's environment.
 *
 *   VITE_ADSENSE_CLIENT  the publisher id, "ca-pub-1234567890123456".
 *                        Unset, there are no ads anywhere and no Google
 *                        script is loaded.
 *   VITE_ADSENSE_SLOT    the id of a responsive display unit made in AdSense.
 *                        Without it no ad is drawn: Auto ads are never used,
 *                        because they would put ads on clue screens.
 *
 * The consent banner visitors in the EEA, the UK and Switzerland must see is
 * AdSense's own (Privacy & messaging, in the AdSense account), served by the
 * same script; nothing here needs to draw one.
 */
const client = String(import.meta.env.VITE_ADSENSE_CLIENT ?? '').trim();

export const ADSENSE_CLIENT = /^ca-pub-\d{10,20}$/.test(client) ? client : null;
export const ADSENSE_SLOT = String(import.meta.env.VITE_ADSENSE_SLOT ?? '').trim() || null;
