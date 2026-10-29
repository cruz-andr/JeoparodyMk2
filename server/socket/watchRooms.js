/**
 * Watching one of the show's episodes together, each on their own device.
 *
 * The server owns the clock: whether the video is playing, from where, and
 * since when. Every device plays its own copy of the video and keeps it where
 * the clock says. At each clue's stop the server stops the clock for
 * everyone and opens the buzzer, as a room on the show does: the first to
 * ring in answers, typed and graded the way every room grades it. Right, and
 * the clock starts again; wrong, and the others may ring in. Final Jeopardy is
 * everyone's, with a wager, as it is on the show.
 *
 * Whoever starts the room drives it: play, pause, and a square on the board
 * to go to that clue. As in a multiplayer game, a right answer takes the
 * board: whoever got the last one right drives. If they leave, the next
 * player in drives.
 *
 * Plain JavaScript over injected time and messages, so the test runs it
 * with a hand-wound clock and no sockets.
 */
import { gradeAnswer } from '../shared/answerMatch.js';
import { TYPING_ANSWER_MS } from '../shared/answerClock.js';
import { reached, scored, stopsFor } from '../shared/watchAlong.js';

// How long the buzzer is open at a clue, and again after a wrong answer.
const BUZZ_MS = 15_000;
const REBUZZ_MS = 8_000;
const FINAL_MS = 60_000;
// How far before a clue's stop a square on the board starts the video.
const LEAD = 10;
// A room nobody is in for this long is forgotten.
const EMPTY_MS = 30 * 60_000;
const MAX_PLAYERS = 12;

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** One more go at a close spelling, as solo play allows: { retry } or { correct }. */
function judge(given, response, closeUsed) {
  const { verdict } = gradeAnswer(given, response);
  if (verdict === 'close' && !closeUsed) return { retry: true };
  return { correct: verdict === 'correct' };
}

export function createWatchRooms({
  loadBoard,
  emitState,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  random = Math.random,
}) {
  const rooms = new Map();

  const newCode = () => {
    for (;;) {
      const code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)]).join('');
      if (!rooms.has(code)) return code;
    }
  };

  /** Where the video is now, by the room's clock. */
  const position = (room) => (room.clock.playing
    ? room.clock.position + (now() - room.clock.since) / 1000
    : room.clock.position);

  const connected = (room) => [...room.players.values()].filter((p) => p.connected);

  /** What every device is told: everything but anyone's retry, which is their own. */
  function view(room) {
    const current = room.current && {
      key: room.current.stop.key,
      phase: room.current.phase,
      deadline: room.current.deadline,
      answering: room.current.answering,
      tried: [...room.current.tried],
      answered: [...room.current.answers.keys()],
    };
    return {
      code: room.code,
      slug: room.slug,
      hostId: room.hostId,
      serverNow: now(),
      clock: { ...room.clock },
      asked: [...room.asked],
      current,
      last: room.last,
      players: [...room.players.values()].map(({ id, name, score, connected: on }) => ({ id, name, score, connected: on })),
    };
  }

  const tell = (room) => emitState(room.code, view(room));

  function wake(room) {
    if (room.timer) clearTimer(room.timer);
    room.timer = null;
    if (room.current) {
      room.timer = setTimer(() => timeUp(room), Math.max(0, room.current.deadline - now()));
      return;
    }
    if (!room.clock.playing) return;
    const t = position(room);
    const { ask } = reached(room.stops, room.asked, t);
    if (ask) { stopAt(room, ask); return; }
    const next = room.stops.find((s) => !room.asked.has(s.key) && s.pause > t);
    if (next) room.timer = setTimer(() => wake(room), (next.pause - t) * 1000);
  }

  function stopAt(room, stop) {
    room.clock = { playing: false, position: stop.pause, since: now() };
    room.current = {
      stop,
      phase: stop.final ? 'final' : 'buzz',
      deadline: now() + (stop.final ? FINAL_MS : BUZZ_MS),
      answering: null,
      tried: new Set(),
      answers: new Map(),
      closeUsed: new Set(),
    };
    // A player with nothing to wager watches Final rather than answers it.
    if (stop.final) {
      for (const p of connected(room)) if (p.score <= 0) room.current.answers.set(p.id, { passed: true, points: 0, noWager: true });
      if (settleIfAllIn(room)) return;
    }
    tell(room);
    wake(room);
  }

  /** Final: everyone in has answered, so on with the video. True if it went on. */
  function settleIfAllIn(room) {
    const waiting = connected(room).filter((p) => !room.current.answers.has(p.id));
    if (waiting.length) return false;
    resolve(room);
    return true;
  }

  /** The buzzer again, for whoever has not tried; or on with the video if nobody is left. */
  function reopen(room) {
    const left = connected(room).filter((p) => !room.current.tried.has(p.id));
    if (!left.length) { resolve(room); return; }
    room.current.phase = 'buzz';
    room.current.answering = null;
    room.current.deadline = now() + REBUZZ_MS;
    tell(room);
    wake(room);
  }

  /** A wrong answer, or silence on the clock: it costs the clue, as on the show. */
  function wrong(room, player, given = '') {
    const points = scored(room.current.stop, false);
    player.score += points;
    room.current.answers.set(player.id, { correct: false, points, given });
    room.current.tried.add(player.id);
    reopen(room);
  }

  function timeUp(room) {
    const { phase, answering } = room.current;
    if (phase === 'answer') wrong(room, room.players.get(answering));
    else resolve(room);
  }

  function resolve(room) {
    const { stop, answers } = room.current;
    room.asked.add(stop.key);
    room.last = { key: stop.key, results: Object.fromEntries(answers) };
    room.current = null;
    room.clock = { playing: true, position: stop.pause, since: now() };
    tell(room);
    wake(room);
  }

  return {
    rooms,

    /** A new room on a board that has an episode to watch. The creator drives. */
    async create({ slug, player }) {
      const board = await loadBoard(slug);
      if (!board?.watch) throw new Error('That board has no episode to watch along with.');
      const room = {
        code: newCode(),
        slug,
        stops: stopsFor(board.watch, board.board),
        hostId: player.id,
        players: new Map(),
        clock: { playing: false, position: 0, since: now() },
        asked: new Set(),
        current: null,
        last: null,
        timer: null,
        emptyTimer: null,
      };
      rooms.set(room.code, room);
      this.join({ code: room.code, player });
      return room.code;
    },

    /** In, or back in after a dropped connection with the same id. */
    join({ code, player }) {
      const room = rooms.get(String(code ?? '').toUpperCase());
      if (!room) throw new Error('That room is not open any more.');
      const seat = room.players.get(player.id);
      if (!seat && room.players.size >= MAX_PLAYERS) throw new Error('That room is full.');
      room.players.set(player.id, {
        id: player.id,
        name: String(player.name || 'Player').slice(0, 24),
        score: seat?.score ?? 0,
        connected: true,
      });
      if (room.emptyTimer) { clearTimer(room.emptyTimer); room.emptyTimer = null; }
      if (!room.players.get(room.hostId)?.connected) room.hostId = player.id;
      tell(room);
      return room.code;
    },

    leave({ code, playerId }) {
      const room = rooms.get(code);
      const seat = room?.players.get(playerId);
      if (!seat) return;
      seat.connected = false;
      if (room.hostId === playerId) room.hostId = connected(room)[0]?.id ?? playerId;
      if (!connected(room).length) {
        room.emptyTimer = setTimer(() => {
          if (room.timer) clearTimer(room.timer);
          rooms.delete(room.code);
        }, EMPTY_MS);
      } else if (room.current?.phase === 'final') {
        settleIfAllIn(room);
      } else if (room.current?.answering === playerId) {
        room.current.tried.add(playerId);
        reopen(room);
      }
      tell(room);
    },

    /** The driver's hand on the video: play, pause, seek to a second, or go to a clue. */
    control({ code, playerId, action, t, column, row }) {
      const room = rooms.get(code);
      if (!room || room.hostId !== playerId) return;
      const at = position(room);
      if (action === 'play') {
        // With a clue up and nobody answering, playing is moving on from it.
        if (room.current) {
          if (room.current.phase === 'answer') return;
          resolve(room);
          return;
        }
        room.clock = { playing: true, position: at, since: now() };
      } else if (action === 'pause') {
        room.clock = { playing: false, position: at, since: now() };
      } else if (action === 'seek' || action === 'clue') {
        let to = Number(t);
        if (action === 'clue') {
          const stop = room.stops.find((s) => s.column === column && s.row === row);
          if (!stop) return;
          to = Math.max(0, stop.pause - LEAD);
        }
        if (!Number.isFinite(to) || to < 0) return;
        // Going elsewhere lets a question that is up go, unanswered.
        room.current = null;
        room.clock = { playing: action === 'clue' ? true : room.clock.playing, position: to, since: now() };
      } else {
        return;
      }
      tell(room);
      wake(room);
    },

    /** First to ring in answers. Returns true if this buzz won. */
    buzz({ code, playerId, key }) {
      const room = rooms.get(code);
      const cur = room?.current;
      const player = room?.players.get(playerId);
      if (!player?.connected || cur?.stop.key !== key || cur.phase !== 'buzz' || cur.tried.has(playerId)) return false;
      cur.phase = 'answer';
      cur.answering = playerId;
      cur.deadline = now() + TYPING_ANSWER_MS;
      tell(room);
      wake(room);
      return true;
    },

    /**
     * A response: from whoever rang in, or from anyone on Final. Returns
     * { retry } for a close spelling (one more go), or { correct, points }.
     */
    answer({ code, playerId, key, given, wager }) {
      const room = rooms.get(code);
      const cur = room?.current;
      const player = room?.players.get(playerId);
      if (!player || cur?.stop.key !== key) return null;
      const final = cur.phase === 'final';
      if (final ? cur.answers.has(playerId) : !(cur.phase === 'answer' && cur.answering === playerId)) return null;
      const text = String(given ?? '').slice(0, 200);
      if (!text.trim()) return null;
      const verdict = judge(text, cur.stop.clue.question, cur.closeUsed.has(playerId));
      if (verdict.retry) {
        cur.closeUsed.add(playerId);
        return { retry: true };
      }
      if (!final && !verdict.correct) {
        const points = scored(cur.stop, false);
        wrong(room, player, text);
        return { correct: false, points };
      }
      const staked = final ? Math.min(Math.max(0, Math.floor(Number(wager) || 0)), Math.max(0, player.score)) : 0;
      const points = scored(cur.stop, verdict.correct, staked);
      player.score += points;
      cur.answers.set(playerId, { correct: verdict.correct, points, given: text });
      // Right takes the board, as it does in a multiplayer game.
      if (!final && verdict.correct) room.hostId = playerId;
      if (final) {
        if (!settleIfAllIn(room)) tell(room);
      } else {
        resolve(room);
      }
      return { correct: verdict.correct, points };
    },

    /** Final only: watch how it ends instead of answering. */
    pass({ code, playerId, key }) {
      const room = rooms.get(code);
      const cur = room?.current;
      if (!room?.players.has(playerId) || cur?.stop.key !== key || cur.phase !== 'final' || cur.answers.has(playerId)) return;
      cur.answers.set(playerId, { passed: true, points: 0 });
      if (!settleIfAllIn(room)) tell(room);
    },

    /** "I had it": a player's own wrong turned right, as solo play allows. */
    overrule({ code, playerId, key }) {
      const room = rooms.get(code);
      const result = room?.last?.key === key ? room.last.results[playerId] : null;
      const player = room?.players.get(playerId);
      if (!result || !player || result.correct || result.passed) return;
      player.score += -result.points * 2;
      // Nobody else had it, so "I had it" takes the board too.
      const others = Object.entries(room.last.results).some(([id, r]) => id !== playerId && r.correct);
      if (room.last.key !== 'final' && !others && room.players.get(playerId).connected) room.hostId = playerId;
      room.last.results[playerId] = { ...result, correct: true, points: -result.points, overruled: true };
      tell(room);
    },

    view: (code) => (rooms.has(code) ? view(rooms.get(code)) : null),
  };
}
