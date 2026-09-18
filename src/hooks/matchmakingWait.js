/* What a player waiting for a quickplay match knows, and what changes it.

   Kept out of the hook so it can be tested without React. The one subtle
   rule lives here: the server drops a socket from the queue the moment it
   disconnects, so a client that keeps believing it is queued across a
   transport blip waits on a frozen clock for ever. The player's wish to be
   queued (`wants`) therefore outlives the queue membership itself
   (`isInQueue`), and whenever the two disagree while connected, the hook
   asks the server again. */

/* fillAfterMs is when the house fills the empty seats; the other two only
   apply on a server that has the house players turned off. */
export const DEFAULT_TIMINGS = { pairAfterMs: 20000, giveUpAfterMs: 45000, fillAfterMs: 20000, fillWithBots: true };
export const NO_MATCH_FALLBACK = 'Nobody else is looking right now.';

export const initialWait = {
  wants: null,          // { displayName, signature, preset } while the player wants a match
  isInQueue: false,     // what the server last confirmed
  queueTime: 0,         // seconds since the server's last queue-joined ack
  timings: DEFAULT_TIMINGS,
  matchFound: null,
  noMatch: null,
};

function timingsFrom(ack, current) {
  const pair = Number(ack?.pairAfterMs);
  const giveUp = Number(ack?.giveUpAfterMs);
  if (!(pair > 0 && giveUp > 0)) return current;
  const fill = Number(ack?.fillAfterMs);
  return {
    pairAfterMs: pair,
    giveUpAfterMs: giveUp,
    fillAfterMs: fill > 0 ? fill : current.fillAfterMs,
    fillWithBots: ack.fillWithBots !== false,
  };
}

export function waitReducer(state, action) {
  switch (action.type) {
    case 'request':
      return {
        ...state,
        wants: { displayName: action.displayName, signature: action.signature, preset: action.preset || 'standard' },
        noMatch: null,
        matchFound: null,
      };
    case 'cancel':
      return { ...state, wants: null };
    case 'joined':
      return {
        ...state,
        isInQueue: true,
        queueTime: 0,
        noMatch: null,
        timings: timingsFrom(action.timings, state.timings),
      };
    case 'left':
      return { ...state, wants: null, isInQueue: false, queueTime: 0 };
    case 'tick':
      return state.isInQueue ? { ...state, queueTime: state.queueTime + 1 } : state;
    case 'match':
      return { ...state, wants: null, isInQueue: false, matchFound: action.match };
    case 'no-match':
      return {
        ...state,
        wants: null,
        isInQueue: false,
        noMatch: { message: action.message || NO_MATCH_FALLBACK },
      };
    case 'dropped':
      // The connection went. The server has already forgotten us; the wish
      // to play stays, so a reconnect can ask again.
      return state.isInQueue ? { ...state, isInQueue: false, queueTime: 0 } : state;
    default:
      return state;
  }
}

/** True when the player wants a match and the server does not yet have them. */
export function needsJoin(state) {
  return !state.isInQueue && state.wants !== null;
}
