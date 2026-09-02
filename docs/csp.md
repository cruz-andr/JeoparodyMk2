# Content-Security-Policy: what we would ship

`vercel.json` deliberately carries no `Content-Security-Policy`. The app loads
Google Fonts, talks to a Socket.io server on another origin, calls Gemini from
the browser, plays audio, and embeds YouTube in media clues. A CSP that misses
any one of those breaks production silently for every visitor, so the header
is written down here first and goes into `vercel.json` only once the origins
below are confirmed against the deployed environment.

## The header

Replace `SOCKET_ORIGIN` with the deployed value of `VITE_SOCKET_URL` (both the
`https://` and the `wss://` forms are needed, since Socket.io polls before it
upgrades).

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://www.youtube.com https://s.ytimg.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: blob: https://i.ytimg.com;
  media-src 'self' data: blob:;
  connect-src 'self' SOCKET_ORIGIN wss://SOCKET_HOST https://generativelanguage.googleapis.com;
  frame-src https://www.youtube.com https://www.youtube-nocookie.com;
  worker-src 'self' blob:;
  manifest-src 'self';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  object-src 'none';
  upgrade-insecure-requests
```

As a single `vercel.json` entry, once confirmed:

```json
{
  "source": "/(.*)",
  "headers": [
    {
      "key": "Content-Security-Policy",
      "value": "default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://i.ytimg.com; media-src 'self' data: blob:; connect-src 'self' SOCKET_ORIGIN wss://SOCKET_HOST https://generativelanguage.googleapis.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; worker-src 'self' blob:; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests"
    }
  ]
}
```

## Why each line

- `style-src 'unsafe-inline'`: framer-motion and a handful of components write
  inline `style` attributes. Dropping `'unsafe-inline'` here needs a nonce
  pipeline Vite does not give a static deploy.
- `font-src fonts.gstatic.com`: Big Shoulders Display and Petrona come from
  Google Fonts via `index.html`.
- `img-src data: blob:`: board covers and signature drawings are data URLs
  and object URLs made in the browser. The Google sign-in avatar is never
  rendered, so `lh3.googleusercontent.com` is not needed until it is.
- `media-src data: blob:`: audio clues are stored as data URLs.
- `connect-src`: the Socket.io server (polling over `https:` and the upgrade
  over `wss:`), plus Gemini at `generativelanguage.googleapis.com`. Confirm
  whether Gemini is called from the browser or via `/api` on the deployed
  build; if only via `/api`, drop the Google origin.
- `frame-src youtube.com`: YouTube media clues embed the player.
- `frame-ancestors 'none'`: mirrors `X-Frame-Options: DENY`. The projector
  window at `/project/*` is opened with `window.open`, not framed, so it is
  unaffected.

## How to roll it out without breaking anyone

1. Ship it first as `Content-Security-Policy-Report-Only` with the same value
   and a `report-to` group, and watch a deployed preview for a day.
2. Open every media type in a host game (image, audio, YouTube), sign in with
   Google, run a multiplayer round, and generate a board with the model.
3. Only then rename the header to `Content-Security-Policy`.

## What the owner has to confirm

- The deployed `VITE_SOCKET_URL` origin (and its `wss://` host).
- Whether Gemini is reached from the browser in production, or only through
  `/api`.
- Whether any board media is hot-linked from arbitrary hosts (if so,
  `img-src` and `media-src` need `https:` rather than a fixed list).
