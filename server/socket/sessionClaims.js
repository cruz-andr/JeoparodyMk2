/**
 * Who may connect as which player.
 *
 * A session id is a player's public id: it is in every payload that names a
 * player, so everyone at the table has it. It was also the whole of a socket's
 * identity, taken from the handshake as given, so anyone who had seen it could
 * connect as that player and buzz, answer, wager or leave for them. Bots' ids
 * went out the same way, so a person could take over a house seat.
 *
 * The browser now sends a second value with its id, a key it keeps to itself
 * and nobody else is ever sent. The first connection to use an id claims it
 * with its key; every later one must bring the same key.
 */

/* An id nobody has used for a day, and that is not at a table, is let go. */
const IDLE_MS = 24 * 60 * 60 * 1000;

/* The client sends a UUID. Anything much shorter is guessable. */
const KEY_SHAPE = /^[A-Za-z0-9-]{16,128}$/;

export function createSessionClaims({ now = Date.now, idleMs = IDLE_MS } = {}) {
  const claims = new Map(); // sessionId -> { key, seen }

  return {
    /**
     * 'ok', or why not: 'no-key' (none, or not shaped like one) or 'taken'.
     * `seated` says the id is already at a table. An unclaimed id in use is a
     * bot's, so it is not up for grabs either.
     */
    admit(sessionId, key, { seated = false } = {}) {
      if (typeof key !== 'string' || !KEY_SHAPE.test(key)) return 'no-key';
      const claim = claims.get(sessionId);
      if (claim) {
        if (claim.key !== key) return 'taken';
        claim.seen = now();
        return 'ok';
      }
      if (seated) return 'taken';
      claims.set(sessionId, { key, seen: now() });
      return 'ok';
    },

    /** A disconnect counts as being seen, so the day starts from the last one. */
    touch(sessionId) {
      const claim = claims.get(sessionId);
      if (claim) claim.seen = now();
    },

    /** Let go of ids idle for a day that are not at a table. */
    sweep(isSeated) {
      const cutoff = now() - idleMs;
      for (const [id, claim] of claims) {
        if (claim.seen < cutoff && !isSeated(id)) claims.delete(id);
      }
    },

    size: () => claims.size,
  };
}
