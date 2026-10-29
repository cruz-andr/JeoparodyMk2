/**
 * Reading an episode off its screens: the text on one frame a second, as the
 * Mac's text recognition gives it, turned into a draft board.
 *
 * It leans on how the show is put together. Every clue is a card of capital
 * letters, the response comes up under it as "ANSWER: WHO IS ...", the rows
 * are played in order ($200 across the board first), and Final Jeopardy has
 * its own title card with the category under it. A clip clue is the card,
 * then the clip with no text on screen, then the answer.
 *
 * Recognition is noisy: it reads a fading card as "HANSWER: WHADIS BRAZIN",
 * a shirt behind the host as "WAAF", and half an answer as "WHAT IS SWI".
 * Nothing here trusts a single frame. Each clue is shown for many seconds,
 * so every reading is a vote, and the reading on the most frames wins.
 * Whatever still is not certain goes on the review list rather than the board.
 *
 * Plain functions with no file or process access, so the test runs them on a
 * recorded episode.
 */

export const POINTS = [200, 400, 600, 800, 1000];

// Marks what a person still has to write. Publishing refuses a board with one.
export const TODO = 'TODO:';

/**
 * ocr.jxa's output, one JSON line a frame, as frames: `lines` is the text top
 * to bottom, `boxes` the same with where each line sits.
 */
export function parseOcr(text) {
  return text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
    .map(({ s, t }) => {
      const boxes = t.map(([text, y, x = null, w = 0]) => ({ text: text.trim(), y, x, w }))
        .filter((b) => b.text)
        .sort((a, b) => a.y - b.y);
      return { s, boxes, lines: boxes.map((b) => b.text) };
    })
    .sort((a, b) => a.s - b.s);
}

/** A YouTube link of any shape, or the bare id, as the id. */
export function youtubeId(value) {
  if (!value) return null;
  if (/^[\w-]{11}$/.test(value)) return value;
  return /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/.exec(value)?.[1] ?? null;
}

/** 905 as "15:05", for the review list and the frames saved beside it. */
export function clock(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Reading a frame ─────────────────────────────────────────

/* "NSWER:" is the answer sliding in over the host's desk, its first letter
   lost against the plate. */
const ANSWER = /N?SWER\s*:\s*(.+)$/;

function answerOn(frame) {
  for (const line of frame.lines) {
    const m = ANSWER.exec(line);
    if (!m) continue;
    // "WHATIS": the space is narrow on the card and sometimes read as none.
    const text = m[1].trim().replace(/^(WHO|WHAT|WHERE|WHEN)(IS|ARE|WAS|WERE)\b/, '$1 $2');
    // "HANSWER:" is the card fading in, "NSWER:" sliding in. They count, for less.
    return { text, clean: line.startsWith('ANSWER:') || line.startsWith('ANSWER ') };
  }
  return null;
}

const letters = (s) => (s.match(/[A-Za-z]/g) ?? []).length;
const capitals = (s) => (s.match(/[A-Z]/g) ?? []).length;

/* The show's own furniture: its logo, the round cards, the rules card's
   bullets. Never part of a clue. */
const FURNITURE = /JEOPARDY|^\s*\S*\s*\d+\s*POINTS?\b|\bROUND\s*$|^[•·*]/i;

// The cards are plain type. A letter from outside it ("SƠUU") is a misreading.
const CARD_TYPE = /^[\x20-\x7E‘’“”…–—•·]+$/;

// The host at his desk: its plate, "DisNEy JEOPARDY" as it is read.
const DESK = /^D\S*\s+JEOPARDY$/i;
const atDesk = (frame) => frame.host || frame.lines.some((line) => DESK.test(line));

/** A line that could be part of a clue card: capitals, and not furniture. */
function cardLine(line) {
  const n = letters(line);
  return n >= 3 && capitals(line) / n >= 0.85 && CARD_TYPE.test(line) && !FURNITURE.test(line) && !ANSWER.test(line);
}

// Enough capitals on screen to be a card, not a stray word read off a shirt.
const CARD_LETTERS = 12;

/* A card has a line of three words at least. Stray words ("ANSIVEI ARIE AND",
   an answer fading in) do not. */
function cardOn(frame, also = () => true) {
  // A poster has its own words in capitals ("HIP HIP POOHRAY!") among lower case ones. A card is all capitals.
  if (frame.lines.filter((line) => /[a-z]{2}/.test(line)).length >= 2 && !atDesk(frame)) return null;
  // A line starting "ANS" is an answer fading in ("ANSIVEI ARIE AND"), unless it reads on, with no colon, as a sentence ("ANSWER THIS QUESTION FROM THE").
  const fading = (line) => /^ANS/.test(line) && (line.includes(':') || line.split(/\s+/).length < 4);
  const lines = frame.lines.filter((line) => cardLine(line) && !fading(line) && also(line));
  const enough = lines.reduce((n, line) => n + letters(line), 0) >= CARD_LETTERS;
  return enough && lines.some((line) => line.split(/\s+/).length >= 3) ? lines : null;
}

/**
 * The reading on the most frames. One cut off at the edge ("WHAT IS SWI")
 * counts toward the whole one it begins; a frame mid fade counts half.
 * `sure` is false when the runner up came close, which goes on the review list.
 */
export function vote(readings) {
  const tally = new Map();
  for (const { text, clean = true } of readings) tally.set(text, (tally.get(text) ?? 0) + (clean ? 1 : 0.5));
  const texts = [...tally.keys()].sort((a, b) => a.length - b.length);
  for (const short of texts) {
    // Four letters or more missing: cut short, not "BINGO" against "BINGOY".
    const whole = texts.find((t) => t.length - short.length >= 4 && t.startsWith(short));
    if (whole) {
      tally.set(whole, tally.get(whole) + tally.get(short));
      tally.delete(short);
    }
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { text: null, sure: false };
  const [[text, top], [, next = 0] = []] = ranked;
  return { text, sure: next < top / 2 };
}

// ── The board on screen ─────────────────────────────────────

// The category names across the top of the board graphic.
const HEADER_BAND = 0.3;

/**
 * The board, when it is on screen: its category names in order across it, a
 * name read as two lines ("BIG" over "THUNDER") put back together. Null on
 * any other frame. It needs where each line sits, which ocr.jxa gives.
 */
const VALUE = /^\$?(200|400|600|800|1000)$/;

function boardOn(frame, columns) {
  const top = frame.boxes.filter((b) => b.x !== null && b.y < HEADER_BAND
    && cardLine(b.text) && b.text.split(/\s+/).length <= 3);
  if (top.length < columns) return null;
  const mid = (b) => b.x + b.w / 2;
  const groups = [];
  for (const b of [...top].sort((p, q) => mid(p) - mid(q))) {
    const group = groups.at(-1);
    if (group && mid(b) - mid(group.at(-1)) < 0.06) group.push(b);
    else groups.push([b]);
  }
  if (groups.length !== columns) return null;
  // Its squares still to play: each value under the column it sits nearest.
  const centres = groups.map((g) => g.reduce((n, b) => n + mid(b), 0) / g.length);
  const column = (b) => centres.reduce((best, x, i) => (Math.abs(x - mid(b)) < Math.abs(centres[best] - mid(b)) ? i : best), 0);
  const squares = new Set(frame.boxes.filter((b) => b.x !== null && VALUE.test(b.text))
    .map((b) => `${column(b)}:${VALUE.exec(b.text)[1]}`));
  return {
    names: groups.map((g) => g.sort((p, q) => p.y - q.y).map((b) => b.text).join(' ')),
    parts: new Set(top.map((b) => b.text)),
    left: squares.size,
  };
}

// ── Finding the clues ───────────────────────────────────────

/**
 * Every stretch of frames with an answer on it, in order. A gap of a few
 * seconds (a cut to the host) does not end one: there is no time in a few
 * seconds for another clue to be read.
 */
function answerRuns(frames) {
  const runs = [];
  let run = null;
  for (const frame of frames) {
    const answer = answerOn(frame);
    if (!answer) continue;
    if (!run || frame.s - run.end > 3) {
      run = { start: frame.s, end: frame.s, readings: [] };
      runs.push(run);
    }
    run.end = frame.s;
    run.readings.push(answer);
  }
  return runs;
}

/*
 * Words that say a clue is about something on screen, or something to hear.
 * Only with one of these does a stretch with no text become the clue's clip.
 */
const SHOWN = /\b(SEEN|SHOWN|PICTURED|WATCH|UPCOMING LINE|NEXT LINE)\b|\bTHIS (SCENE|CLIP|IMAGE|PICTURE)\b/;
const HEARD = /\b(HEAR|HEARD|LISTEN)\b|\bTHIS (SONG|SOUND|VOICE)\b/;

/**
 * The card before an answer: the run of card frames nearest before it,
 * after the last answer. Its text is the reading most of them agree on.
 */
function cardBefore(frames, from, to, also, { first = false } = {}) {
  const shown = frames.filter((f) => f.s > from && f.s < to)
    .map((f) => ({ s: f.s, lines: cardOn(f, also) }))
    .filter((f) => f.lines);
  // Runs of card frames, a few seconds' gap allowed. A card is up for seconds: one frame is a title flying past.
  const runs = [];
  for (const f of shown) {
    if (runs.length && f.s - runs.at(-1).at(-1).s <= 4) runs.at(-1).push(f);
    else runs.push([f]);
  }
  const run = runs.filter((r) => r.length >= 2).at(first ? 0 : -1);
  if (!run) return null;
  /* The card has as many lines as most of its frames read: a frame with one
     more has something passing over it (the score, "YUUU"), one with fewer
     is the card flying in. Each line is then the reading most of those
     frames agree on, so one word read three ways ("FUTURE", "FOTURE",
     "FOTORE") does not cost the line. */
  const counts = new Map();
  for (const f of run) counts.set(f.lines.length, (counts.get(f.lines.length) ?? 0) + 1);
  const size = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const like = run.filter((f) => f.lines.length === size);
  const lines = Array.from({ length: size }, (_, i) => vote(like.map((f) => ({ text: f.lines[i] }))));
  return { lines: lines.map((l) => l.text), sure: lines.every((l) => l.sure), start: run[0].s, end: run.at(-1).s };
}

/** The first second after `from` with an answer starting to show, however badly read ("ANSIVEI"). */
function answerShowsAt(frames, from, to) {
  return frames.find((f) => f.s > from && f.s <= to && f.lines.some((l) => /^.?ANS|N?SWER\s*:/.test(l)))?.s ?? to;
}

const said = (f) => letters(f.lines.join(''));

/**
 * Footage straight off the board, with no card: a picture to name (a poster
 * zoomed in on). It runs until the host is back, or until the screen fills
 * with words, which is the picture shown whole: the answer.
 */
function pictureAfter(frames, from, to) {
  const shown = frames.filter((f) => f.s > from && f.s < to);
  const start = shown.find((f) => !f.board && !atDesk(f));
  if (!start) return null;
  const base = Math.max(...shown.filter((f) => f.s >= start.s && f.s <= start.s + 1).map(said));
  const stop = shown.find((f) => f.s > start.s && (f.board || atDesk(f) || answerOn(f) || said(f) > base + 8));
  const end = (stop?.s ?? to) - 1;
  return end - start.s >= 2 ? { start: start.s, end } : null;
}

/** The words on the first stretch of footage after `from`: where an answer with no answer bar is said. */
function shownText(frames, from, to) {
  const run = [];
  for (const f of frames) {
    if (f.s <= from || f.s >= to) continue;
    if (f.board || atDesk(f) || !said(f)) {
      if (run.length) break;
      continue;
    }
    run.push(f);
  }
  /* Read as the screen has it: words on one level are one line, left to
     right. Lyrics filled in over a clip come one word to a box. */
  const rows = (f) => {
    const out = [];
    for (const b of [...f.boxes].sort((p, q) => p.y - q.y)) {
      const row = out.at(-1);
      if (row && b.y - row[0].y < 0.02) row.push(b);
      else out.push([b]);
    }
    return out.map((row) => row.sort((p, q) => (p.x ?? 0) - (q.x ?? 0)).map((b) => b.text).join(' '));
  };
  const seen = new Map();
  for (const f of run) for (const line of new Set(rows(f))) if (letters(line) >= 3) seen.set(line, (seen.get(line) ?? 0) + 1);
  return [...seen].filter(([, n]) => n >= 2).map(([line]) => line).slice(0, 6);
}

/**
 * One clue: the stretch from the board it was picked from (`seg.from`) to
 * the board after it (`seg.to`), with its answer `run` in it if the answer
 * was put on screen.
 */
function readClue(frames, run, stretch, problems, where) {
  const to = run?.start ?? stretch.to;
  /* A Daily Double puts its own screens between the board and the card, then
     asks for a wager: the clue starts after the wager card. */
  const wager = frames.findLast((f) => f.s > stretch.from && f.s < to && f.lines.some((l) => /DAILY DOUBLE/.test(l)));
  const seg = wager ? { ...stretch, from: wager.s, fromBoard: false } : stretch;
  /* Picked off the board, a clue's card flies out of its square straight
     away. When what comes first is footage instead, the clue is a picture,
     and words later on (the poster shown whole) are its answer, not a card. */
  const opening = seg.fromBoard ? frames.filter((f) => f.s > seg.from && f.s < to && !f.board).slice(0, 3) : [];
  const pictured = opening.length > 0 && !opening.some((f) => cardOn(f));
  const card = pictured ? null : cardBefore(frames, seg.from, to, undefined, { first: Boolean(seg.fromBoard) });
  const response = run ? vote(run.readings) : { text: null, sure: true };
  const clue = {
    lines: card?.lines ?? [],
    response: response.text,
    at: card?.start ?? seg.from + 1,
    answerAt: run?.start ?? null,
    clip: null,
  };
  const unanswered = (after) => {
    if (run) return;
    const says = shownText(frames, after, seg.to);
    problems.push({
      where, at: after + 1, blocking: true,
      note: `No answer was put on screen. Write the response${says.length ? `; the screen after the clue reads: ${says.join(' / ')}` : ''}.`,
    });
  };
  if (!card) {
    clue.clip = pictureAfter(frames, seg.from, to);
    clue.at = clue.clip?.start ?? clue.at;
    problems.push({
      where, at: clue.at, blocking: true,
      note: clue.clip
        ? `The clue is a picture with no words, played as its clip (${clock(clue.clip.start)} to ${clock(clue.clip.end)}). Write the clue for it.`
        : 'No clue card was found.',
    });
    unanswered(clue.clip?.end ?? seg.from);
    return clue;
  }
  if (!card.sure) problems.push({ where, at: card.start, note: 'The clue text was read two ways; check it against the video.' });
  if (!response.sure) problems.push({ where, at: run.start, note: 'The response was read two ways; check it against the video.' });
  unanswered(card.end);

  const text = card.lines.join(' ');
  const seen = SHOWN.test(text);
  const heard = HEARD.test(text);
  let answerAt = answerShowsAt(frames, card.end, to);
  // With no answer on screen, the clue is over when the board is back.
  if (!run) answerAt = frames.find((f) => f.s > card.end && f.s < answerAt && f.board)?.s ?? answerAt;

  /* A sound to name plays under its card, which stays up until the answer
     ("LISTEN UP AND NAME THE DISNEY CHANNEL SHOW"). */
  if (heard && !seen && (answerAt - card.end <= 2 || card.end - card.start >= 6)) {
    clue.clip = { start: card.start, end: answerAt - card.end <= 2 ? answerAt - 1 : card.end, audio: true };
    return clue;
  }

  /* Off the card, the host at his desk is him talking, and footage after he
     has talked is the answer being shown: the Mulan clip after "GET THIS SONG
     MIX STARTED" is the song it names. A clip is footage straight off the
     card. */
  const between = frames.filter((f) => f.s > card.end && f.s < answerAt);
  const lastDesk = between.findLast(atDesk)?.s ?? null;
  const offScreen = answerAt - card.end - 1;
  // Footage with no word on the card to say so is a clip when it is long: a scene to finish, not a moment's cutaway.
  /* With no answer bar to come, footage straight off the card is the answer
     being shown (lyrics filled in over the song), not a clip to play first. */
  if (lastDesk === null && run && offScreen >= ((seen || heard) ? 4 : 8)) {
    clue.clip = { start: card.end + 1, end: answerAt - 1 };
    if (!seen && !heard) {
      problems.push({
        where, at: card.end + 1,
        note: `Footage straight off the card (${clock(card.end + 1)} to ${clock(answerAt - 1)}) plays as the clue's clip. Check it does not give the answer away.`,
      });
    }
  } else if (seen && answerAt - lastDesk - 1 >= 4) {
    problems.push({
      where, at: lastDesk + 1,
      note: `The host talks, then footage plays into the answer (${clock(lastDesk + 1)} to ${clock(answerAt - 1)}). That is usually the answer being shown; if it is the clue's clip, add it.`,
    });
  } else if (seen) {
    problems.push({ where, at: card.start, note: 'The clue talks about something shown, but no clip was found. Check for a picture.' });
  }
  return clue;
}

// ── Final Jeopardy ──────────────────────────────────────────

const FINAL = /^FINAL\s+JEOPARDY/i;

function readFinal(frames, run, after, problems) {
  const where = 'Final Jeopardy';
  /* The category is the lines under the title card, as most frames read
     them: a name, or a few ("LADY & THE TRAMP, / ENCANTO, / ROGER RABBIT"),
     each short. The clue comes up under the same title in long lines, so a
     frame with those is the clue, not the category ("AVATAR", in the film's
     own lettering, is up for three seconds; its clue for forty). */
  const under = (g) => g.lines.slice(g.i + 1).filter(cardLine);
  const titled = frames.filter((f) => f.s > after && f.s < run.start)
    .map((f) => ({ s: f.s, i: f.lines.findIndex((l) => FINAL.test(l)), lines: f.lines }))
    .filter((f) => f.i !== -1 && f.lines[f.i + 1] && cardLine(f.lines[f.i + 1]))
    .filter((f, _, all) => {
      const named = (g) => under(g).length <= 4 && under(g).every((l) => l.split(/\s+/).length <= 5);
      return named(f) || !all.some(named);
    });
  const category = vote(titled.map((f) => ({ text: f.lines.some((l, n) => n > f.i && l.split(/\s+/).length > 5) ? f.lines[f.i + 1] : under(f).join('\n') })));
  const categoryLines = new Set(category.text?.split('\n') ?? []);
  if (category.text) category.text = category.text.replace(/\n/g, ' ');
  const lastTitle = titled.at(-1)?.s ?? after;
  if (!category.text) problems.push({ where, at: run.start, blocking: true, note: 'The category was not found.' });

  const card = cardBefore(frames, lastTitle, run.start,
    (line) => !FINAL.test(line) && !categoryLines.has(line) && !/WAGER/.test(line));
  const response = vote(run.readings);
  const final = {
    category: category.text, lines: card?.lines ?? [], response: response.text,
    at: card?.start ?? lastTitle + 1, answerAt: run.start, clip: null,
  };
  if (!response.sure) problems.push({ where, at: run.start, note: 'The response was read two ways; check it against the video.' });

  // No words on screen between the title and the answer: the clue is a picture.
  if (!card) {
    // The pictures, until the host is back: after him come the answers being shown.
    const back = frames.find((f) => f.s > lastTitle + 1 && f.s < run.start && atDesk(f))?.s;
    final.clip = { start: lastTitle + 1, end: (back ?? answerShowsAt(frames, lastTitle, run.start)) - 1 };
    problems.push({
      where, at: lastTitle + 1, blocking: true,
      note: 'The clue is a picture with no words. Write the clue for it (the clip plays beside it).',
    });
  }
  return final;
}

// ── The episode ─────────────────────────────────────────────

function findCategories(frames, start, end, columns) {
  const opened = frames.find((f) => f.s < end && f.lines.some((l) => /THE CATEGOR/i.test(l)))?.s ?? start;
  const names = [];
  const seen = new Map();
  for (const f of frames) {
    if (f.s <= opened || f.s >= end) continue;
    const lines = f.lines.filter((l) => cardLine(l) && !/CATEGOR|EPISODE/i.test(l));
    const name = lines.join(' ').replace(/\s+/g, ' ').trim();
    const n = letters(name);
    if (n < 4 || n > 40 || name.split(' ').length > 5) continue;
    seen.set(name, (seen.get(name) ?? 0) + 1);
    // Two seconds on screen makes it a category card, not a passing word.
    if (seen.get(name) === 2) names.push(name);
  }
  return names.slice(0, columns * 2);
}

/** The column a category name belongs to: the one whose clues say it. */
function placeNames(names, columnText) {
  const placed = new Array(columnText.length).fill(null);
  for (const name of names) {
    const hits = columnText.map((text) => text.includes(name));
    if (hits.filter(Boolean).length === 1) placed[hits.indexOf(true)] = name;
  }
  if (names.length === columnText.length && placed.every((p) => p === null)) return [...names];
  return placed;
}

/**
 * The whole episode, read. Returns the clues and Final as found (capitals,
 * second marks and all) plus the problems found reading them; draftBoard
 * turns that into a board.
 *
 * @param categories  names to use instead of reading them off the cards
 */
/** "FINAL" over "JEOPARDY", as the newer board has its title, read as the one title. */
function joinFinal(frame) {
  const i = frame.lines.findIndex((l, n) => /^FINAL$/i.test(l) && /^JEOPARDY$/i.test(frame.lines[n + 1] ?? ''));
  if (i === -1) return frame;
  const lines = [...frame.lines];
  lines.splice(i, 2, 'FINAL JEOPARDY');
  return { ...frame, lines, boxes: frame.boxes.filter((b) => !/^(FINAL|JEOPARDY)$/i.test(b.text)) };
}

/**
 * Where each clue was played: from the board it was picked off to the board
 * after it, told by how many squares the board has left. Not every clue puts
 * its answer on screen (a zoomed-in poster is answered by the poster), so the
 * board, which comes back after every clue, is what keeps count.
 *
 * `boards` is every frame the board is on with its squares left. A count on
 * two frames running is trusted; one on a single frame is a square caught
 * mid zoom. Returns a stretch for each clue, or null where the board was
 * never seen with that many squares (two clues then share one stretch).
 */
function boardStretches(boards, target, end) {
  const steady = [];
  boards.forEach((b, i) => {
    const next = boards[i + 1];
    const last = steady.at(-1);
    if (last && last.left === b.left && b.s - last.to <= 3) last.to = b.s;
    else if (next && next.left === b.left && next.s - b.s <= 2) steady.push({ left: b.left, from: b.s, to: b.s });
  });
  const stretches = [];
  for (let k = 0; k < target; k++) {
    const left = target - k;
    const at = steady.filter((b) => b.left === left).at(-1);
    if (!at) {
      stretches.push(null);
      continue;
    }
    const next = steady.find((b) => b.from > at.to && b.left < left);
    stretches.push({ from: at.to, to: next?.from ?? end, fromBoard: true });
  }
  return stretches;
}

export function readEpisode(shown, { categories = null } = {}) {
  let frames = shown.map(joinFinal);
  const problems = [];
  const all = frames.flatMap((f) => f.lines);
  const episode = Number(all.map((l) => /EPISODE\s+(\d+)/i.exec(l)?.[1]).find(Boolean)) || null;
  const said = Number(all.map((l) => /(\d+)\s+CATEGORIES ON THE BOARD/i.exec(l)?.[1]).find(Boolean));

  const runs = answerRuns(frames);
  const finalSeen = (f) => f.lines.some((l) => FINAL.test(l));
  const finalTitle = frames.find((f) => runs.length && f.s > runs[0].start && finalSeen(f));
  const finalIndex = finalTitle ? runs.findIndex((r) => r.start > finalTitle.s) : -1;
  const answered = finalIndex === -1 ? runs : runs.slice(0, finalIndex);

  const columns = categories?.length || said || (answered.length > 25 ? 6 : 5);
  const target = columns * POINTS.length;

  // The board's names are read, then taken off the frame: they are not a clue.
  const boards = [];
  const left = [];
  frames = frames.map((f) => {
    const board = boardOn(f, columns);
    if (!board) return f;
    boards.push(board.names.join('|'));
    if (board.left) left.push({ s: f.s, left: board.left });
    return { ...f, board: Boolean(board.left), headed: true, lines: f.lines.filter((l) => !board.parts.has(l)) };
  });

  /* The host, when his desk has no plate to read: what is on his shirt
     ("ZERO BOTHERS GIVEN"), which is on screen far more than anything else
     but is never a card. A frame with nothing but such words is him. */
  const onFrames = new Map();
  for (const f of frames) if (!f.headed) for (const line of new Set(f.lines)) onFrames.set(line, (onFrames.get(line) ?? 0) + 1);
  const always = new Set([...onFrames].filter(([, n]) => n > Math.max(30, frames.length * 0.03)).map(([line]) => line));
  frames = frames.map((f) => (!f.headed && f.lines.length && f.lines.every((l) => always.has(l)) && !cardOn(f) ? { ...f, host: true } : f));

  // The end of the last clue: Final's wager card, or its title.
  const finalFrom = frames.find((f) => f.s > (left.at(-1)?.s ?? 0) && (finalSeen(f) || f.lines.some((l) => /^WAGER\b/.test(l))))?.s;
  const stretches = boardStretches(left, target, finalFrom ?? frames.at(-1)?.s ?? 0);
  // A board missed between two clues leaves one stretch with both answers in it: it ends after the first.
  for (let i = 1; i < stretches.length; i++) {
    const before = stretches[i - 1];
    if (stretches[i] || !before) continue;
    const inside = answered.filter((x) => x.start > before.from && x.start < before.to);
    /* With one answer between them (a poster has none), the board caught
       once, on a single frame, between the two clues is where they part. */
    const between = left.find((b) => b.s > before.from + 5 && b.s < before.to - 5);
    const split = inside.length >= 2 ? inside[0].end : between?.s;
    if (split === undefined) continue;
    stretches[i] = { from: split, to: before.to, fromBoard: inside.length < 2 };
    before.to = split + 1;
  }

  /* Each clue's answer is the answer run in its stretch. Where the board
     was missed, so a stretch is not known, the answer runs fall back on
     order: the next one not yet used. */
  const cells = Array.from({ length: columns }, () => new Array(POINTS.length).fill(null));
  const used = new Set();
  let lost = 0;
  stretches.forEach((seg, i) => {
    const c = i % columns, r = Math.floor(i / columns);
    const where = { column: c, row: r };
    if (!seg) {
      const run = answered.find((x) => !used.has(x) && x.start > (stretches[i - 1]?.from ?? -1));
      if (!run) {
        lost++;
        return;
      }
      used.add(run);
      const from = Math.max(stretches[i - 1]?.from ?? -1, [...used].filter((x) => x.end < run.start).at(-1)?.end ?? -1);
      cells[c][r] = readClue(frames, run, { from, to: run.start }, problems, where);
      return;
    }
    const mine = answered.filter((x) => x.start > seg.from && x.start < seg.to && !used.has(x));
    mine.forEach((x) => used.add(x));
    const run = mine.length ? { start: mine[0].start, end: mine.at(-1).end, readings: mine.flatMap((x) => x.readings) } : null;
    cells[c][r] = readClue(frames, run, seg, problems, where);
  });
  if (lost || stretches.every((x) => !x)) {
    problems.push({
      where: 'The board', at: answered[0]?.start ?? 0, blocking: true,
      note: `Found ${target - lost} of the ${target} clues a ${columns} category board has. Check the board was read.`,
    });
  }

  const final = finalIndex === -1 ? null
    : readFinal(frames, runs[finalIndex], (finalFrom ?? finalTitle.s) - 1, problems);
  if (!final) problems.push({ where: 'Final Jeopardy', at: 0, note: 'No Final Jeopardy was found. The board will have none.' });

  let names;
  if (categories) {
    names = categories.map((n) => n.trim().toUpperCase());
  } else {
    const firstCard = cells[0][0]?.at ?? answered[0]?.start ?? 0;
    const cards = findCategories(frames, 0, firstCard, columns);
    const onBoard = vote(boards.map((text) => ({ text }))).text?.split('|');
    if (onBoard) {
      /* The board cuts a long name short ("BIG THUNDER"); its own title card,
         before the first clue, has all of it. */
      names = onBoard.map((name) => cards.find((card) => card.length > name.length && card.startsWith(`${name} `)) ?? name);
    } else {
      const columnText = cells.map((col) => col.map((cl) => cl?.lines.join(' ') ?? '').join(' '));
      names = placeNames(cards, columnText);
    }
  }

  return { episode, columns, cells, final, names, problems };
}

// ── Writing it as a board ───────────────────────────────────

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with']);

/** "WHEN YOU WISH UPON A STAR" as "When You Wish Upon a Star". */
export function titleCase(text, { leadingSmall = false } = {}) {
  let first = true;
  return text.toLowerCase().replace(/[a-z][a-z']*/g, (w) => {
    const small = (!first || leadingSmall) && SMALL.has(w);
    first = false;
    return small ? w : w[0].toUpperCase() + w.slice(1);
  });
}

const RESPONSE = /^(WHO|WHAT|WHERE|WHEN)\s+(IS|ARE|WAS|WERE)\s+(.+)$/i;

/** "WHO IS EDDIE MURPHY" as "Who is Eddie Murphy?" */
export function formatResponse(raw) {
  const text = raw.replace(/[\s.?!]+$/, '').replace(/\s+-\s+/g, ', ').trim();
  const m = RESPONSE.exec(text);
  if (!m) return `What is ${titleCase(text, { leadingSmall: true })}?`;
  // "the Western River Expedition", but a title in quotes starts with a capital.
  const subject = titleCase(m[3], { leadingSmall: !/^['"‘“]/.test(m[3]) });
  return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2].toLowerCase()} ${subject}?`;
}

const LABEL = /^([0-9]+|[A-Z])\)\s/;

/**
 * A card's lines as one clue, with a list ("1) SWIFT", "A) RAGING FIRE")
 * punctuated as one. Two lists side by side are read across, row by row, so
 * they are put back in order: the numbers, then the letters.
 */
function joinCard(card) {
  const first = card.findIndex((l) => LABEL.test(l));
  const lines = first === -1 ? card : [
    ...card.slice(0, first),
    ...card.slice(first).filter((l) => LABEL.test(l))
      .sort((a, b) => (/^\d/.test(b) - /^\d/.test(a)) || LABEL.exec(a)[1].localeCompare(LABEL.exec(b)[1], 'en', { numeric: true })),
    ...card.slice(first).filter((l) => !LABEL.test(l)),
  ];
  let out = '';
  let prev = null;
  for (const line of lines) {
    const label = LABEL.exec(line)?.[1] ?? null;
    if (!out) out = line;
    else if (label === null) out += ` ${line}`;
    else if (prev === null) out += `: ${line}`;
    else out += (/\d/.test(label) === /\d/.test(prev) ? ', ' : '. ') + line;
    prev = label;
  }
  out = out.replace(/\s+/g, ' ').replace(/:\s*:/g, ':').trim()
    // A blank drawn as dots is read as dots and bullets ("HIM A SPARE ...•").
    .replace(/\.*[•·][.•·]*|\.{4,}/g, '____');
  // The blank is a line on the card, which is not text to read.
  if (/^FILL IN THE BLANK/i.test(out) && !/_/.test(out)) out += ' ____';
  return out;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A card in sentence case, with the names put back: the show's capitals say
 * nothing about which words are names, so `names` does (the categories, the
 * responses, and names.txt).
 */
export function sentenceCase(text, names = []) {
  let s = text.toLowerCase()
    .replace(/(^|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase())
    .replace(/\b([0-9]+|[a-z])\)\s+([a-z])/gi, (_, a, b) => `${a.toUpperCase()}) ${b.toUpperCase()}`)
    .replace(/\bi\b/g, 'I')
    // A title in quotes: 'Reflection', 'Make a Man Out of You'.
    .replace(/(^|\s)'([^']+?)'(?=[\s,.!?;:)]|$)/g, (_, a, b) => `${a}'${titleCase(b)}'`);
  for (const [from, to] of [...names].sort((a, b) => b[0].length - a[0].length)) {
    s = s.replace(new RegExp(`(^|[^A-Za-z])${escape(from.toLowerCase())}(?=[^A-Za-z]|$)`, 'gi'), (_, a) => a + to);
  }
  return s.replace(/^[a-z]/, (c) => c.toUpperCase());
}

/** names.txt: one name a line, or "WRONG = Right" where the show spells it its own way. */
export function parseNames(text) {
  return text.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
    .map((l) => (l.includes('=') ? l.split('=').map((x) => x.trim()) : [l, l]));
}

function media(clip, youtube) {
  if (!clip) return {};
  if (!youtube) return null;
  return { mediaType: 'youtube', mediaData: youtube, youtubeStart: clip.start, youtubeEnd: clip.end, audioOnly: Boolean(clip.audio) };
}

const blank = { options: null, mediaType: null, mediaData: null, youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: null };

/**
 * The house board file (server/houseBoards) for an episode as read, and the
 * review list to go with it. Anything a person must write is a TODO, which
 * publishing will not let through.
 */
export function draftBoard(read, { youtube = null, names = [], show = null, description = null, topic = null } = {}) {
  const problems = [...read.problems];
  const known = [...names];
  for (const name of read.names) if (name) known.push([name, titleCase(name)]);
  for (const cl of [...read.cells.flat(), read.final]) {
    const m = cl?.response && RESPONSE.exec(cl.response.replace(/[\s.?!]+$/, ''));
    // Whoever a "Who is" names is a name wherever the board says it.
    if (m && /^WHO$/i.test(m[1])) {
      for (const part of m[3].split(/\s*(?:,|\bAND\b)\s*/i)) if (letters(part) >= 3) known.push([part, titleCase(part)]);
    }
  }

  const label = (c, r) => `${read.names[c] || `Category ${c + 1}`} $${POINTS[r]}`;
  const clipFor = (clip, where, at) => {
    const m = media(clip, youtube);
    if (m === null) problems.push({ where, at, blocking: true, note: 'This clue has a clip, but no --youtube video was given to play it from.' });
    return m ?? {};
  };

  const categories = read.cells.map((col, c) => ({
    name: read.names[c] || `${TODO} name this category`,
    questions: col.map((cl, r) => {
      const where = label(c, r);
      if (!cl) return { ...blank, points: POINTS[r], answer: `${TODO} missing clue`, question: `${TODO} missing response` };
      return {
        ...blank,
        points: POINTS[r],
        answer: cl.lines.length ? sentenceCase(joinCard(cl.lines), known) : `${TODO} write the clue`,
        question: cl.response ? formatResponse(cl.response) : `${TODO} write the response`,
        ...clipFor(cl.clip, where, cl.at),
      };
    }),
  }));
  read.names.forEach((name, c) => {
    if (!name) problems.push({ where: `Column ${c + 1}`, at: read.cells[c][0]?.at ?? 0, blocking: true, note: 'The category name was not read. Look at the category cards.' });
  });

  const f = read.final;
  const finalJeopardy = f ? {
    category: f.category ?? `${TODO} name the category`,
    answer: f.lines.length ? sentenceCase(joinCard(f.lines), known) : `${TODO} write the clue for the picture`,
    question: f.response ? formatResponse(f.response) : `${TODO} write the response`,
    altText: null,
    ...clipFor(f.clip, 'Final Jeopardy', f.at),
  } : null;

  const episode = read.episode;
  const file = {
    title: show && episode ? `${show}: Episode ${episode}` : `${TODO} title`,
    description,
    topic,
    featured: false,
    board: { version: 1, categories, ...(finalJeopardy ? { finalJeopardy } : {}) },
  };

  // Where each review item is, said the way a person finds it.
  const named = problems.map((p) => ({
    ...p,
    where: typeof p.where === 'string' ? p.where : label(p.where.column, p.where.row),
  }));
  return { file, problems: named };
}

/** Every TODO still in a board file, by where it is. */
export function todosIn(file) {
  const found = [];
  const walk = (value, path) => {
    if (typeof value === 'string' && value.includes(TODO)) found.push(`${path}: ${value}`);
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(file, '');
  return found;
}
