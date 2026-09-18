/**
 * Quickplay, run by the house.
 *
 * A private room has a host who picks a genre, edits the categories and
 * presses Start. A quickplay table has nobody in that chair: three strangers
 * were seated by a matchmaker and none of them should have to run the game
 * for the others, or wait while one of them does. So the server does it. It
 * deals a board the moment the table is seated, moves the game from round to
 * round when the board is cleared, runs Final Jeopardy, and closes the game.
 *
 * It also plays the empty seats. When the matchmaker fills a table with house
 * players (see bots.js for who they are), this is what makes them act: read a
 * clue, ring in, answer, pick the next one, wager, pass. Each act is a timer
 * that fires into the same functions a socket handler calls (actions.js), so
 * a bot cannot do anything a person could not.
 *
 * Every event the room is told about passes through onRoomEvent, which is how
 * the director hears a clue open and a buzzer fall without holding a socket.
 */
import { fetchGameById } from '../services/jarchiveScraper.js';
import { buildBoard, DOUBLE_ROW_VALUES } from '../services/dailyBuilder.js';
import { FALLBACK_GAME } from '../data/quickplayBoards.js';
import {
  knows, guesses, buzzDelayMs, rebuzzDelayMs, answerDelayMs, skipDelayMs, answersCorrectly,
  pickCell, pickDelayMs, dailyDoubleWager, finalWager, wrongFinalAnswer, between,
} from './bots.js';

/* How long after the match is announced the board is dealt. The client shows
   "match found" for two seconds, then loads the game page; the rest is room
   for a slow phone to get there and take its seat. */
export const DEAL_AFTER_MS = 6000;
/* The client shows a correct answer for three seconds before the board comes
   back. A pick that lands inside that window is drawn over by the reveal
   clearing, so nothing the house does follows a closed clue sooner than this. */
const REVEAL_MS = 3400;
/* Round one's standings are on screen for this long before round two. */
const ROUND_BREAK_MS = 7000;
/* Final Jeopardy's results stay up for this long before the game closes. */
const FINAL_REVEAL_MS = 14000;
/* A table with no person left at it is cleared after this long. Long enough
   for a reload to come back; short enough that bots do not play an empty
   room for half an hour. */
const ABANDON_MS = 60000;

/** A flat, category-major list of 30 clues into the 6x5 grid rooms use. */
export function toGrid(board, rows = 5) {
  const grid = [];
  for (let c = 0; c < board.categories.length; c++) {
    grid.push(board.questions.slice(c * rows, (c + 1) * rows));
  }
  return grid;
}

/**
 * A full game out of one scraped episode: both rounds and the final, or null
 * when the episode is short a round.
 */
export function gameFromEpisode(episode) {
  const clues = episode?.clues ?? [];
  const first = buildBoard(clues.filter((c) => c.round === 'jeopardy'));
  const second = buildBoard(clues.filter((c) => c.round === 'double_jeopardy'), { values: DOUBLE_ROW_VALUES });
  if (!first || !second) return null;
  return {
    source: `j-archive:${episode.gameId}`,
    round1: { categories: first.categories, questions: toGrid(first) },
    round2: { categories: second.categories, questions: toGrid(second) },
    final: episode.final
      ? { category: episode.final.category, answer: episode.final.clue, question: episode.final.answer }
      : null,
  };
}

/* Deep enough copy that one table revealing a clue does not reveal it for the
   next table dealt the same board. */
const copyGame = (game) => JSON.parse(JSON.stringify(game));

/**
 * Where boards come from. `mode` is 'archive' (a random J-Archive episode,
 * the house board if that fails) or 'static' (the house board, always).
 * prepare() starts a fetch early so take() has something ready.
 */
export function createBoardSource({ mode = 'archive', fetchGame = fetchGameById, random = Math.random, attempts = 3, log = () => {} } = {}) {
  let ready = null;
  let inFlight = null;

  async function fetchOne() {
    if (mode !== 'archive') return copyGame(FALLBACK_GAME);
    for (let i = 0; i < attempts; i++) {
      const id = 1000 + Math.floor(random() * 8000);
      try {
        const game = gameFromEpisode(await fetchGame(id));
        if (game) return game;
        log(`quickplay: episode ${id} is short a round`);
      } catch (err) {
        log(`quickplay: episode ${id}: ${err.message}`);
      }
    }
    return copyGame(FALLBACK_GAME);
  }

  function prepare() {
    if (ready || inFlight) return inFlight ?? Promise.resolve(ready);
    inFlight = fetchOne().then((game) => { ready = game; return game; })
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  async function take() {
    if (!ready) await prepare();
    const game = ready;
    ready = null;
    prepare().catch(() => {}); // warm the next one for the next table
    return copyGame(game);
  }

  return { prepare, take };
}

export function createQuickplayDirector({
  gameManager, actions, boardSource,
  setTimeout: schedule = setTimeout, clearTimeout: cancel = clearTimeout,
  random = Math.random, log = () => {},
}) {
  /* roomCode -> { timers, game, bots: Map(botId -> { profile, sure, lastPick }), fjAnswer } */
  const tables = new Map();

  const roomOf = (code) => gameManager.rooms.get(code);
  const tableOf = (code) => tables.get(code);

  function humansSeated(room) {
    return [...room.players.values()].some((p) => !p.isBot && p.isConnected);
  }

  /* Every house move goes through here, so a table that has been torn down
     in the meantime never has a timer fire into it. */
  function later(code, ms, fn) {
    const table = tableOf(code);
    if (!table) return;
    const t = schedule(() => {
      table.timers.delete(t);
      if (!tables.has(code) || !roomOf(code)) return;
      try { fn(); } catch (err) { log(`quickplay ${code}: ${err.message}`); }
    }, ms);
    table.timers.add(t);
  }

  function dispose(code) {
    const table = tableOf(code);
    if (!table) return;
    for (const t of table.timers) cancel(t);
    tables.delete(code);
  }

  /* The bots at a table, as [id, state] pairs. */
  const botsAt = (code) => [...(tableOf(code)?.bots ?? [])];

  function scores(room) {
    return [...room.players.values()].map((p) => ({ id: p.id, score: p.score || 0 }));
  }

  // ---------------------------------------------------------------- dealing

  async function deal(code) {
    const room = roomOf(code);
    const table = tableOf(code);
    if (!room || !table) return;
    if (!humansSeated(room)) { abandon(code); return; }
    try {
      table.game = await boardSource.take();
    } catch (err) {
      log(`quickplay ${code}: no board (${err.message}), dealing the house board`);
      table.game = copyGame(FALLBACK_GAME);
    }
    if (!tables.has(code) || !roomOf(code)) return;
    const ids = [...room.players.keys()];
    actions.setQuestions(code, {
      questions: table.game.round1.questions,
      categories: table.game.round1.categories,
      firstPickerId: ids[Math.floor(random() * ids.length)],
      dailyDoubles: null,
    });
    log(`quickplay ${code}: dealt ${table.game.source}`);
  }

  function boardCleared(room) {
    const qs = room.gameState?.questions ?? [];
    return qs.length > 0 && qs.every((column) => column.every((q) => q.revealed));
  }

  /* A clue has fully resolved and the board is about to come back. If it came
     back empty, the round is over and the house moves the game on. */
  function afterClue(code) {
    later(code, REVEAL_MS, () => {
      const room = roomOf(code);
      const table = tableOf(code);
      if (!room?.gameState || room.gameState.currentQuestion) return;
      if (!boardCleared(room)) return;

      const round = room.gameState.currentRound || 1;
      if (round === 1 && room.settings.enableDoubleJeopardy && table.game?.round2) {
        actions.roundEnd(code, 1);
        later(code, ROUND_BREAK_MS, () => {
          const current = roomOf(code);
          if (!current) return;
          /* The show hands the first pick of Double Jeopardy to whoever is
             trailing. Only the seated: a bot never leaves, a person might. */
          const trailing = scores(current).sort((a, b) => a.score - b.score)[0];
          actions.startRound2(code, {
            questions: table.game.round2.questions,
            categories: table.game.round2.categories,
            firstPickerId: trailing?.id ?? null,
            dailyDoubles: null,
          });
        });
        return;
      }
      if (room.settings.enableFinalJeopardy) {
        actions.startFinalJeopardy(code, table.game?.final ?? null);
      } else {
        actions.endGame(code);
      }
    });
  }

  function abandon(code) {
    log(`quickplay ${code}: nobody left at the table`);
    dispose(code);
    gameManager.destroyRoom(code);
  }

  // -------------------------------------------------------------- the bots

  function schedulePick(code, botId, ms) {
    later(code, ms, () => {
      const room = roomOf(code);
      const bot = tableOf(code)?.bots.get(botId);
      if (!room?.gameState || !bot) return;
      if (room.gameState.currentPickerId !== botId || room.gameState.currentQuestion) return;
      const cell = pickCell(
        bot.profile,
        room.gameState.questions,
        (c, r) => Boolean(room.gameState.questions[c]?.[r]?.revealed),
        bot.lastPick,
        random
      );
      if (!cell) return;
      bot.lastPick = cell;
      actions.selectQuestion(botId, code, cell.categoryIndex, cell.pointIndex);
    });
  }

  /* Whoever holds the pick, if it is a bot, takes it after a pause. */
  function pickerMoves(code, pickerId, ms) {
    if (tableOf(code)?.bots.has(pickerId)) schedulePick(code, pickerId, ms);
  }

  function onClueOpened(code, payload) {
    const table = tableOf(code);
    const room = roomOf(code);
    if (!table || !room) return;
    const { question, pointIndex, isDailyDouble, pickerId } = payload;
    const clueText = question?.answer ?? '';

    if (isDailyDouble) {
      const bot = table.bots.get(pickerId);
      if (!bot) return;
      bot.sure = knows(bot.profile, pointIndex, random);
      later(code, between(3000, 5000, random), () => {
        const player = roomOf(code)?.players.get(pickerId);
        if (!player) return;
        const wager = dailyDoubleWager(bot.profile, player.score || 0, roomOf(code).gameState.currentRound || 1, random);
        actions.dailyDoubleWager(pickerId, code, wager);
        later(code, between(4000, 7000, random), () => {
          actions.dailyDoubleAnswer(pickerId, code, bot.sure && answersCorrectly(true, random));
        });
      });
      return;
    }

    for (const [botId, bot] of table.bots) {
      bot.sure = knows(bot.profile, pointIndex, random);
      const ringsIn = bot.sure || guesses(bot.profile, random);
      if (ringsIn) {
        later(code, buzzDelayMs(bot.profile, clueText, { sure: bot.sure, random }), () => {
          const current = roomOf(code);
          if (!current?.gameState?.buzzWindowOpen) return;
          actions.buzz(botId, code, 0);
        });
      } else if (random() < 0.75) {
        /* Most people who do not know a clue say so, which is what lets a clue
           nobody knows end before the whole clock runs out. */
        later(code, skipDelayMs(clueText, random), () => {
          const current = roomOf(code);
          if (!current?.gameState?.currentQuestion || current.gameState.buzzedPlayerId) return;
          actions.skipQuestion(botId, code);
        });
      }
    }
  }

  function onBuzzerWinner(code, { playerId }) {
    const bot = tableOf(code)?.bots.get(playerId);
    if (!bot) return;
    later(code, answerDelayMs(bot.profile, { sure: bot.sure, random }), () => {
      const current = roomOf(code);
      if (current?.gameState?.buzzedPlayerId !== playerId) return;
      actions.submitAnswer(playerId, code, answersCorrectly(bot.sure, random));
    });
  }

  function onAnswerResult(code, { correct, canBuzzAgain, nextPickerId }) {
    if (!correct && canBuzzAgain) {
      /* Somebody got it wrong. The bots who know it and have not had a go
         reach for the buzzer again; the clue is already read. */
      const room = roomOf(code);
      for (const [botId, bot] of botsAt(code)) {
        if (room.gameState.playersWhoBuzzed?.has(botId)) continue;
        if (room.gameState.skippedPlayers?.has(botId)) continue;
        if (!(bot.sure || guesses(bot.profile, random))) continue;
        later(code, rebuzzDelayMs(bot.profile, random), () => {
          const current = roomOf(code);
          if (!current?.gameState?.buzzWindowOpen) return;
          actions.buzz(botId, code, 0);
        });
      }
      return;
    }
    pickerMoves(code, nextPickerId, REVEAL_MS + pickDelayMs(random));
    afterClue(code);
  }

  function onBuzzTimeout(code) {
    for (const [botId] of botsAt(code)) {
      later(code, between(900, 2600, random), () => actions.timeoutContinue(botId, code));
    }
  }

  function onAllContinued(code, { nextPickerId }) {
    pickerMoves(code, nextPickerId, pickDelayMs(random));
    afterClue(code);
  }

  function onDailyDoubleResult(code, { nextPickerId }) {
    pickerMoves(code, nextPickerId, 1500 + pickDelayMs(random));
    afterClue(code);
  }

  function onFinalStarted(code, { answer }) {
    const table = tableOf(code);
    const room = roomOf(code);
    if (!table || !room) return;
    table.fjAnswer = answer;
    const eligible = room.gameState?.finalJeopardy?.eligiblePlayers ?? new Set();
    const all = scores(room);
    for (const [botId, bot] of table.bots) {
      if (!eligible.has(botId)) continue;
      /* The clients show the category for three seconds before asking for a
         wager; a bot that answered inside that would be ahead of the screen. */
      later(code, between(4500, 9500, random), () => {
        const me = all.find((s) => s.id === botId)?.score ?? 0;
        const others = all.filter((s) => s.id !== botId).map((s) => s.score);
        actions.fjWager(botId, code, finalWager(me, others, random));
        bot.sure = random() < bot.profile.skill * 0.8;
      });
    }
  }

  function onFinalClue(code) {
    const table = tableOf(code);
    const room = roomOf(code);
    if (!table || !room) return;
    const eligible = room.gameState?.finalJeopardy?.eligiblePlayers ?? new Set();
    for (const [botId, bot] of table.bots) {
      if (!eligible.has(botId)) continue;
      later(code, between(8000, 17000, random), () => {
        actions.fjAnswer(botId, code, bot.sure ? table.fjAnswer : wrongFinalAnswer(random));
      });
    }
  }

  // ---------------------------------------------------------------- the API

  return {
    /** A table has been seated. Remember its bots and deal in a moment. */
    onMatch(match) {
      const room = roomOf(match.roomCode);
      if (!room) return;
      const bots = new Map();
      for (const seat of match.seats ?? []) {
        if (seat.isBot) bots.set(seat.socket.sessionId, { profile: seat.profile, sure: false, lastPick: null });
      }
      tables.set(match.roomCode, { timers: new Set(), bots, game: null, fjAnswer: null });
      later(match.roomCode, DEAL_AFTER_MS, () => { deal(match.roomCode); });
    },

    /** Everything the room is told, in the order it is told. */
    onRoomEvent(code, event, payload = {}) {
      if (!tables.has(code)) return;
      switch (event) {
        case 'game:questions-ready':
        case 'game:round-2-started':
          pickerMoves(code, payload.firstPickerId, 1200 + pickDelayMs(random));
          break;
        case 'game:question-selected': onClueOpened(code, payload); break;
        case 'game:buzzer-winner': onBuzzerWinner(code, payload); break;
        case 'game:answer-result': onAnswerResult(code, payload); break;
        case 'game:buzz-timeout-result': onBuzzTimeout(code); break;
        case 'game:all-continued': onAllContinued(code, payload); break;
        case 'game:daily-double-result': onDailyDoubleResult(code, payload); break;
        case 'game:final-jeopardy-started': onFinalStarted(code, payload); break;
        case 'game:fj-show-clue': onFinalClue(code); break;
        case 'game:fj-reveal':
          later(code, FINAL_REVEAL_MS, () => actions.endGame(code));
          break;
        case 'game:ended':
          /* The game is over. The room stays for the standings; the table's
             timers do not. */
          dispose(code);
          break;
        default:
          break;
      }
    },

    /** A person left or dropped. If none is left in a while, clear the table. */
    onPlayerGone(code) {
      if (!tables.has(code)) return;
      later(code, ABANDON_MS, () => {
        const room = roomOf(code);
        if (room && !humansSeated(room)) abandon(code);
      });
    },

    /** For tests: is this table still being run? */
    isRunning: (code) => tables.has(code),

    disposeAll() { for (const code of [...tables.keys()]) dispose(code); },
  };
}
