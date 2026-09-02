import { useEffect, useMemo, useState } from 'react';
import { useUserStore } from '../stores';
import { gameHistory, myStats } from '../services/api/gamesService';
import { apiRecord, deviceOnlyGames, localRecord } from '../utils/gameRecord';

/**
 * Your record: the archive when you are signed in, localStorage when not.
 *
 * Both come back in one shape (see utils/gameRecord.js), so a page reads
 * `record.stats` and `record.games` and never asks where they came from.
 * `source` says anyway, for the one line of copy that wants to.
 *
 * If the server cannot be reached the local record stands in rather than an
 * empty page: a number that is a little behind beats no number at all.
 *
 * Signed in, the archive is the record and the local copy is not merged into
 * it: a game the server never saw cannot be filed after the fact without
 * taking the client's word for the score. `deviceOnly` says how many such
 * games this device has, so the page can say so instead of showing someone
 * with forty local games "No games yet" and nothing else.
 */
export function useGameRecord({ limit = 20 } = {}) {
  const token = useUserStore((s) => s.token);
  const isAuthenticated = useUserStore((s) => s.isAuthenticated);
  const stats = useUserStore((s) => s.stats);
  const localHighscores = useUserStore((s) => s.localHighscores);

  const [remote, setRemote] = useState(null);
  const [loading, setLoading] = useState(Boolean(token && isAuthenticated));

  useEffect(() => {
    if (!token || !isAuthenticated) {
      setRemote(null);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    Promise.all([myStats(token), gameHistory(token, limit)])
      .then(([s, h]) => {
        if (alive) setRemote(apiRecord({ stats: s.stats, games: h.games }));
      })
      .catch(() => {
        if (alive) setRemote(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [token, isAuthenticated, limit]);

  const local = useMemo(() => localRecord({ stats, localHighscores }), [stats, localHighscores]);

  return {
    record: remote ?? local,
    source: remote ? 'account' : 'local',
    deviceOnly: deviceOnlyGames(local, remote),
    loading,
  };
}
