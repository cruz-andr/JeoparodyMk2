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
const CARD_TYPE = /^[\x20-\x7E‘’“”…–—]+$/;

// The host at his desk: its plate, "DisNEy JEOPARDY" as it is read.
const DESK = /^D\S*\s+JEOPARDY$/i;
const atDesk = (frame) => frame.lines.some((line) => DESK.test(line));

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
  const lines = frame.lines.filter((line) => cardLine(line) && !/^ANS/.test(line) && also(line));
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
  return {
    names: groups.map((g) => g.sort((p, q) => p.y - q.y).map((b) => b.text).join(' ')),
    parts: new Set(top.map((b) => b.text)),
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
const SHOWN = /\b(SEEN|SHOWN|PICTURED|WATCH)\b|\bTHIS (SCENE|CLIP|IMAGE|PICTURE)\b/;
const HEARD = /\b(HEAR|HEARD|LISTEN)\b|\bTHIS (SONG|SOUND|VOICE)\b/;

/**
 * The card before an answer: the run of card frames nearest before it,
 * after the last answer. Its text is the reading most of them agree on.
 */
function cardBefore(frames, from, to, also) {
  const shown = frames.filter((f) => f.s > from && f.s < to)
    .map((f) => ({ s: f.s, lines: cardOn(f, also) }))
    .filter((f) => f.lines);
  if (!shown.length) return null;
  const run = [shown.at(-1)];
  for (let i = shown.length - 2; i >= 0 && run[0].s - shown[i].s <= 4; i--) run.unshift(shown[i]);
  /* A line on fewer than half the card's frames is something passing over
     it (the score, "YUUU"), not the card. */
  const seen = new Map();
  for (const f of run) for (const line of new Set(f.lines)) seen.set(line, (seen.get(line) ?? 0) + 1);
  const steady = (line) => seen.get(line) >= run.length / 2;
  const { text, sure } = vote(run.map((f) => ({ text: f.lines.filter(steady).join('\n') })).filter((r) => r.text));
  if (!text) return null;
  return { lines: text.split('\n'), sure, start: run[0].s, end: run.at(-1).s };
}

/** The first second after `from` with an answer starting to show, however badly read ("ANSIVEI"). */
function answerShowsAt(frames, from, to) {
  return frames.find((f) => f.s > from && f.s <= to && f.lines.some((l) => /^.?ANS|N?SWER\s*:/.test(l)))?.s ?? to;
}

function readClue(frames, run, after, problems, where) {
  const card = cardBefore(frames, after, run.start);
  const response = vote(run.readings);
  const clue = {
    lines: card?.lines ?? [],
    response: response.text,
    at: card?.start ?? run.start,
    answerAt: run.start,
    clip: null,
  };
  if (!card) {
    problems.push({ where, at: run.start, blocking: true, note: 'No clue card was found before this answer.' });
    return clue;
  }
  if (!card.sure) problems.push({ where, at: card.start, note: 'The clue text was read two ways; check it against the video.' });
  if (!response.sure) problems.push({ where, at: run.start, note: 'The response was read two ways; check it against the video.' });

  const text = card.lines.join(' ');
  const seen = SHOWN.test(text);
  const heard = HEARD.test(text);
  const answerAt = answerShowsAt(frames, card.end, run.start);

  /* A sound to name plays under its card, which stays up until the answer
     ("LISTEN UP AND NAME THE DISNEY CHANNEL SHOW"). */
  if (heard && !seen && answerAt - card.end <= 2) {
    clue.clip = { start: card.start, end: answerAt - 1, audio: true };
    return clue;
  }

  /* Off the card, the host at his desk is him talking, and footage after he
     has talked is the answer being shown: the Mulan clip after "GET THIS SONG
     MIX STARTED" is the song it names. A clip is footage straight off the
     card. */
  const between = frames.filter((f) => f.s > card.end && f.s < answerAt);
  const lastDesk = between.findLast(atDesk)?.s ?? null;
  const offScreen = answerAt - card.end - 1;
  if (lastDesk === null && offScreen >= 4 && (seen || heard)) {
    clue.clip = { start: card.end + 1, end: answerAt - 1 };
  } else if (lastDesk === null && offScreen >= 8) {
    problems.push({
      where, at: card.end + 1,
      note: `The screen leaves the card for ${offScreen}s before the answer (${clock(card.end + 1)} to ${clock(answerAt - 1)}). If that is a clip, add it.`,
    });
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
  /* The category is the line under the title card, as most frames read it.
     The clue comes up under the same title, so a frame with more than the
     one line under it is the clue, not the category ("AVATAR", in the film's
     own lettering, is up for three seconds; its clue for forty). */
  const titled = frames.filter((f) => f.s > after && f.s < run.start)
    .map((f) => ({ s: f.s, i: f.lines.findIndex((l) => FINAL.test(l)), lines: f.lines }))
    .filter((f) => f.i !== -1 && f.lines[f.i + 1] && cardLine(f.lines[f.i + 1]))
    .filter((f, _, all) => {
      const alone = (g) => g.lines.slice(g.i + 1).filter(cardLine).length === 1;
      return alone(f) || !all.some(alone);
    });
  const category = vote(titled.map((f) => ({ text: f.lines[f.i + 1] })));
  const lastTitle = titled.at(-1)?.s ?? after;
  if (!category.text) problems.push({ where, at: run.start, blocking: true, note: 'The category was not found.' });

  const card = cardBefore(frames, lastTitle, run.start,
    (line) => !FINAL.test(line) && line !== category.text && !/WAGER/.test(line));
  const response = vote(run.readings);
  const final = {
    category: category.text, lines: card?.lines ?? [], response: response.text,
    at: card?.start ?? lastTitle + 1, answerAt: run.start, clip: null,
  };
  if (!response.sure) problems.push({ where, at: run.start, note: 'The response was read two ways; check it against the video.' });

  // No words on screen between the title and the answer: the clue is a picture.
  if (!card) {
    final.clip = { start: lastTitle + 1, end: answerShowsAt(frames, lastTitle, run.start) - 1 };
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
export function readEpisode(shown, { categories = null } = {}) {
  let frames = shown;
  const problems = [];
  const all = frames.flatMap((f) => f.lines);
  const episode = Number(all.map((l) => /EPISODE\s+(\d+)/i.exec(l)?.[1]).find(Boolean)) || null;
  const said = Number(all.map((l) => /(\d+)\s+CATEGORIES ON THE BOARD/i.exec(l)?.[1]).find(Boolean));

  const runs = answerRuns(frames);
  const finalSeen = (f) => f.lines.some((l) => FINAL.test(l));
  const finalTitle = frames.find((f) => runs.length && f.s > runs[0].start && finalSeen(f));
  const finalIndex = finalTitle ? runs.findIndex((r) => r.start > finalTitle.s) : -1;
  const played = finalIndex === -1 ? runs : runs.slice(0, finalIndex);

  const columns = categories?.length || said || (played.length > 25 ? 6 : 5);
  const target = columns * POINTS.length;

  // The board's names are read, then taken off the frame: they are not a clue.
  const boards = [];
  frames = frames.map((f) => {
    const board = boardOn(f, columns);
    if (!board) return f;
    boards.push(board.names.join('|'));
    return { ...f, lines: f.lines.filter((l) => !board.parts.has(l)) };
  });
  if (played.length !== target) {
    problems.push({
      where: 'The board', at: played[0]?.start ?? 0, blocking: true,
      note: `Found ${played.length} clues before Final Jeopardy, where a ${columns} category board has ${target}.`,
    });
  }

  // Played in order: every $200 across the board, then every $400, and so on.
  const cells = Array.from({ length: columns }, () => new Array(POINTS.length).fill(null));
  played.slice(0, target).forEach((run, i) => {
    const c = i % columns, r = Math.floor(i / columns);
    cells[c][r] = readClue(frames, run, i ? played[i - 1].end : -1, problems, { column: c, row: r });
  });

  const final = finalIndex === -1 ? null
    : readFinal(frames, runs[finalIndex], played.at(-1)?.end ?? -1, problems);
  if (!final) problems.push({ where: 'Final Jeopardy', at: 0, note: 'No Final Jeopardy was found. The board will have none.' });

  let names;
  if (categories) {
    names = categories.map((n) => n.trim().toUpperCase());
  } else {
    const firstCard = cells[0][0]?.at ?? played[0]?.start ?? 0;
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
  out = out.replace(/\s+/g, ' ').replace(/:\s*:/g, ':').trim();
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
