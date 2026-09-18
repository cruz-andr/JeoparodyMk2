/**
 * The house players.
 *
 * When quickplay cannot fill a table with people it fills the empty seats
 * from here. A bot is a seat with a name, a temperament and a few numbers
 * that decide how it plays: how much it knows, how fast it reaches for the
 * buzzer, how often it guesses, how it wanders the board. Nothing in this
 * file touches a socket or a timer. Every function takes what it needs and
 * says what the bot would do, so the whole roster can be tested with a
 * counter standing in for the clock and a list standing in for chance.
 *
 * What makes them read as people is the mistakes: they take time to read a
 * clue, they buzz on things they do not know, they get the expensive rows
 * wrong more often than the cheap ones, and none of them is the same.
 */

/* Twelve regulars. skill is the chance of knowing a $200 clue; every row down
   the board takes a slice off it. speed is 0 (slow) to 1 (quick). nerve is
   how often a bot buzzes on a clue it does not actually know. style is how it
   picks: 'column' works down one category, 'cheap' clears the low rows first,
   'roam' picks anywhere. */
export const ROSTER = [
  { name: 'Priya', skill: 0.78, speed: 0.55, nerve: 0.18, style: 'column' },
  { name: 'Marcus', skill: 0.66, speed: 0.80, nerve: 0.40, style: 'roam' },
  { name: 'Dee', skill: 0.72, speed: 0.45, nerve: 0.22, style: 'cheap' },
  { name: 'Tomas', skill: 0.58, speed: 0.70, nerve: 0.48, style: 'roam' },
  { name: 'Hannah', skill: 0.81, speed: 0.35, nerve: 0.12, style: 'column' },
  { name: 'Kenji', skill: 0.69, speed: 0.62, nerve: 0.30, style: 'cheap' },
  { name: 'Rosa', skill: 0.63, speed: 0.75, nerve: 0.36, style: 'roam' },
  { name: 'Femi', skill: 0.75, speed: 0.50, nerve: 0.25, style: 'column' },
  { name: 'Ingrid', skill: 0.70, speed: 0.40, nerve: 0.20, style: 'cheap' },
  { name: 'Leo', skill: 0.60, speed: 0.85, nerve: 0.52, style: 'roam' },
  { name: 'Aisha', skill: 0.77, speed: 0.58, nerve: 0.16, style: 'column' },
  { name: 'Walt', skill: 0.65, speed: 0.30, nerve: 0.28, style: 'cheap' },
];

/* A stand-in for Math.random that a test can replace. */
const roll = (random) => (random ? random() : Math.random());

/* A number between lo and hi, uniformly. */
export const between = (lo, hi, random) => lo + (hi - lo) * roll(random);

/** A short id that cannot collide with a session id, which are UUIDs, nor
    with another bot's: the counter, not the dice, is what keeps them apart. */
let seatSeq = 0;
function botId(random) {
  const n = Math.floor(roll(random) * 0xffffff).toString(36);
  return `bot-${(seatSeq++).toString(36)}-${n}`;
}

/**
 * Seats for `count` bots, avoiding any name already at the table.
 *
 * Each seat looks enough like a queued player for the matchmaker to treat it
 * as one: a socket-shaped object with a session id, a display name, and no
 * signature, because nobody drew one.
 */
export function seatBots(count, { taken = [], random } = {}) {
  const takenLower = new Set(taken.map((n) => String(n || '').trim().toLowerCase()));
  const pool = ROSTER.filter((b) => !takenLower.has(b.name.toLowerCase()));
  const seats = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const [profile] = pool.splice(Math.floor(roll(random) * pool.length), 1);
    const id = botId(random);
    seats.push({
      socket: { id, sessionId: id, userId: null, isBot: true },
      displayName: profile.name,
      signature: null,
      isBot: true,
      profile,
      queuedAt: 0,
    });
  }
  return seats;
}

/* Reading time. People read a clue before they reach for anything, at
   something like thirty characters a second, and the fastest player on the
   show is still not buzzing on a two-line clue inside a second. */
export function readingMs(text) {
  const chars = String(text || '').length;
  return Math.min(6500, Math.max(1100, 800 + chars * 32));
}

/**
 * Does this bot know the clue? Row 0 is the cheapest. Each row down takes
 * eleven points off the chance, so a 0.75 bot knows about 42 percent of the
 * bottom row, which is roughly how a decent contestant actually does.
 */
export function knows(profile, rowIndex, random) {
  const p = profile.skill * (1 - 0.11 * Math.max(0, rowIndex));
  return roll(random) < p;
}

/** Whether a bot that does not know the clue rings in anyway. */
export function guesses(profile, random) {
  return roll(random) < profile.nerve;
}

/**
 * When the bot buzzes, in ms after the clue appears. Reading first, then a
 * reaction that a quick bot makes in about half a second and a slow one in
 * a second and a half, with the ordinary wobble of a thumb on a button. A
 * bot that is guessing hesitates a little longer than one that knows.
 */
export function buzzDelayMs(profile, clueText, { sure = true, random } = {}) {
  const read = readingMs(clueText) * between(0.72, 1.05, random);
  const reaction = 1500 - 1000 * profile.speed;
  const hesitation = sure ? 0 : between(300, 1100, random);
  return Math.round(read + reaction + hesitation + between(0, 500, random));
}

/** A second try, after somebody else got it wrong: the clue is already read. */
export function rebuzzDelayMs(profile, random) {
  return Math.round(600 + (1 - profile.speed) * 900 + between(0, 700, random));
}

/** Time from winning the buzz to giving the answer. The window is about 7s. */
export function answerDelayMs(profile, { sure = true, random } = {}) {
  return Math.round(between(sure ? 1100 : 1900, sure ? 2800 : 4200, random));
}

/** When a bot that does not know a clue gives up on it and passes. */
export function skipDelayMs(clueText, random) {
  return Math.round(readingMs(clueText) + between(1800, 4500, random));
}

/** Whether a bot answers correctly once it has the floor. */
export function answersCorrectly(sure, random) {
  return roll(random) < (sure ? 0.92 : 0.30);
}

/**
 * The bot's pick from the board. `revealedKey` tells whether "c-r" is gone.
 * Each style is a habit, not a rule: a fifth of picks go anywhere, which is
 * what stops a bot marching down one column like a program.
 */
export function pickCell(profile, questions, revealedKey, lastPick, random) {
  const open = [];
  questions.forEach((column, c) => column.forEach((_, r) => {
    if (!revealedKey(c, r)) open.push({ categoryIndex: c, pointIndex: r });
  }));
  if (open.length === 0) return null;

  const anywhere = () => open[Math.floor(roll(random) * open.length)];
  if (roll(random) < 0.2) return anywhere();

  if (profile.style === 'column' && lastPick) {
    const same = open.filter((o) => o.categoryIndex === lastPick.categoryIndex)
      .sort((a, b) => a.pointIndex - b.pointIndex);
    if (same.length) return same[0];
  }
  if (profile.style === 'cheap') {
    const lowest = Math.min(...open.map((o) => o.pointIndex));
    const cheap = open.filter((o) => o.pointIndex === lowest);
    return cheap[Math.floor(roll(random) * cheap.length)];
  }
  if (profile.style === 'column') {
    /* Start a fresh column from its highest open row. */
    const topOf = new Map();
    for (const o of open) {
      const t = topOf.get(o.categoryIndex);
      if (!t || o.pointIndex < t.pointIndex) topOf.set(o.categoryIndex, o);
    }
    const tops = [...topOf.values()];
    return tops[Math.floor(roll(random) * tops.length)];
  }
  return anywhere();
}

/** How long a bot looks at the board before picking. */
export function pickDelayMs(random) {
  return Math.round(between(1800, 4200, random));
}

/**
 * A Daily Double wager. Confident bots bet big, nervous ones bet a round
 * number they can afford. The server clamps whatever comes back.
 */
export function dailyDoubleWager(profile, score, round, random) {
  const boardMax = round === 2 ? 2000 : 1000;
  const ceiling = Math.max(score, boardMax, 5);
  if (roll(random) < profile.skill - 0.45) return ceiling; // a true daily double
  const share = between(0.25, 0.7, random);
  return Math.max(5, Math.round((ceiling * share) / 100) * 100 || 200);
}

/**
 * A Final Jeopardy wager in the show's habits: the leader wagers enough to
 * cover second place doubling up, the rest bet most of what they have.
 */
export function finalWager(score, others, random) {
  if (score <= 0) return 0;
  const top = Math.max(0, ...others);
  if (score > top) {
    const cover = 2 * top - score + 1;
    return Math.min(score, Math.max(0, cover + Math.round(between(0, 400, random) / 100) * 100));
  }
  return Math.round((score * between(0.6, 1, random)) / 100) * 100;
}

/** A wrong Final answer that reads like a person wrote it. */
export function wrongFinalAnswer(random) {
  const stabs = ['What is Jupiter?', 'Who is Napoleon?', 'What is Canada?', 'What is the Nile?',
    'Who is Mozart?', 'What is 1066?', 'What is Mercury?', 'Who is Dickens?', 'What is Brazil?'];
  return stabs[Math.floor(roll(random) * stabs.length)];
}
