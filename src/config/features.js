/**
 * Features that exist in the code but are not ready to ship.
 *
 * Each one is on under `npm run dev`, so it can still be worked on, and off in
 * a production build unless the build sets its variable to 'true'. Setting it
 * to 'false' turns it off in dev too, to see the site as it will ship.
 */
function flag(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return import.meta.env.DEV;
}

/* Host mode: the /host setup page, the /project projector screen, the menu
   tile and a community board's "Host it in a room" button. The server side
   stays as it is; nothing can reach it without the pages. */
export const HOST_MODE = flag(import.meta.env.VITE_ENABLE_HOST_MODE);

/* Boards written by a model (Gemini): the Single Player tile and its genre
   setup, and a private room's "write questions for the room". Off, a room
   plays a real episode or a community board, and solo play is the dailies,
   their archive and a community board's "Play it solo", none of which need a
   model. */
export const AI_BOARDS = flag(import.meta.env.VITE_ENABLE_AI_BOARDS);
