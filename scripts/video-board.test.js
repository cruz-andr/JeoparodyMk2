/**
 * The video board reader, run on Episode 40 as the Mac read it, against the
 * board that was transcribed from the same video by hand and is on the site,
 * on Episode 21, for the ways a show can trip it, and on Episodes 188 to 181,
 * the newer show.
 * Run with: node scripts/video-board.test.js
 *
 * The wording will not match letter for letter (the hand copy fixed the
 * show's typos and its capitals), so a clue is right when it is in the right
 * square and says nearly the same thing.
 */
import { readFileSync } from 'node:fs';
import {
  TODO, draftBoard, formatResponse, parseNames, parseOcr, readEpisode, sentenceCase, titleCase, todosIn, vote, youtubeId,
} from './video-board/read.mjs';
import { normalizeBoard, publishProblem, validateBoardStructure } from '../server/shared/boardFormat.js';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${!ok && detail ? `  ${detail}` : ''}`);
};

const at = (p) => new URL(p, import.meta.url);
const frames = parseOcr(readFileSync(at('./video-board/fixtures/episode-40.ocr.jsonl'), 'utf8'));
const published = JSON.parse(readFileSync(at('../server/houseBoards/disney-jeopardy-40.json'), 'utf8'));
const names = parseNames(readFileSync(at('./video-board/names.txt'), 'utf8'));
const VIDEO = 'u4YFjksxPg0';

const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1));
function alike(a, b) {
  const x = words(a), y = words(b);
  return [...x].filter((w) => y.has(w)).length / Math.max(x.size, y.size);
}

// ---------- the pieces ----------

check('a reading cut short counts toward the whole one',
  vote([{ text: 'WHAT IS SWI' }, { text: 'WHAT IS SWI' }, { text: 'WHAT IS SWIFT/RIVER' }]).text === 'WHAT IS SWIFT/RIVER');
check('one letter of difference is not cut short: the frames decide',
  vote([{ text: 'BINGOY', clean: false }, { text: 'BINGOY' }, { text: 'BINGO' }, { text: 'BINGO' }]).text === 'BINGO');
check('and a close count is not sure', !vote([{ text: 'A' }, { text: 'A' }, { text: 'B' }]).sure);
check('a response comes out as the show would say it',
  formatResponse('WHO IS EDDIE MURPHY') === 'Who is Eddie Murphy?'
  && formatResponse('WHAT IS THE WESTERN RIVER EXPEDITION') === 'What is the Western River Expedition?'
  && formatResponse("WHAT IS 'WHEN YOU WISH UPON A STAR'") === "What is 'When You Wish Upon a Star'?"
  && formatResponse("WHAT IS 'ON WITH THE SHOW'") === "What is 'On with the Show'?",
  formatResponse("WHAT IS 'WHEN YOU WISH UPON A STAR'"));
check('titles keep their small words small', titleCase('MAKE A MAN OUT OF YOU') === 'Make a Man Out of You');
check('a card reads as a sentence, with its names put back',
  sentenceCase("DURING 'REFLECTION', MULAN PULLS OFF HER MAKEUP", [['Mulan', 'Mulan']])
    === "During 'Reflection', Mulan pulls off her makeup");
check('and a name the show misspells is put right', sentenceCase('FLORDIA', parseNames('FLORDIA = Florida')) === 'Florida');
check('a YouTube link of any shape gives its video',
  [`https://www.youtube.com/watch?v=${VIDEO}&t=4`, `https://youtu.be/${VIDEO}`, VIDEO].every((v) => youtubeId(v) === VIDEO)
  && youtubeId('not a video') === null);

// ---------- Episode 40, read ----------

const read = readEpisode(frames);
const { file, problems } = draftBoard(read, { youtube: VIDEO, names, show: 'Disney 100 Jeopardy', topic: 'disney' });
const mine = file.board;
const theirs = published.board;

check('it knows which episode it is', read.episode === 40 && file.title === 'Disney 100 Jeopardy: Episode 40', file.title);
check('five categories, from the rules card', read.columns === 5 && mine.categories.length === 5);
check('their names, read off the board, the long one from its own title card',
  mine.categories.map((c) => c.name).join('|') === theirs.categories.map((c) => c.name).join('|'),
  mine.categories.map((c) => c.name).join('|'));

const squares = theirs.categories.flatMap((cat, c) => cat.questions.map((q, r) => ({ c, r, q })));
let placed = 0;
let responses = 0;
const wrong = [];
for (const { c, r, q } of squares) {
  const got = mine.categories[c].questions[r];
  // In the right square: closer to this square's clue than to any other.
  const best = squares.reduce((top, s) => (alike(got.answer, s.q.answer) > alike(got.answer, top.q.answer) ? s : top));
  if (best.c === c && best.r === r && alike(got.answer, q.answer) >= 0.5) placed++;
  else wrong.push(`${c},${r}: ${got.answer}`);
  if (alike(got.question, q.question) >= 0.6) responses++;
  else wrong.push(`${c},${r}: ${got.question} / ${q.question}`);
}
check('all 25 clues, each in its own square', placed === 25, `${placed}/25 ${wrong.slice(0, 3).join(' · ')}`);
check('each with its response', responses === 25, `${responses}/25`);

const grannies = mine.categories[2].questions[4];
check("Bluey's $1000 plays the grannies clip, from the end of the card to the answer",
  grannies.mediaType === 'youtube' && grannies.mediaData === VIDEO
  && grannies.youtubeStart === 895 && grannies.youtubeEnd === 906,
  JSON.stringify([grannies.youtubeStart, grannies.youtubeEnd]));
const clips = mine.categories.flatMap((cat) => cat.questions).filter((q) => q.mediaType);
check('and it is the only clip: the host talking is not one', clips.length === 1, `${clips.length} clips`);
check('the eleven seconds off the parks card are the host at his desk, so not a clip and not a question',
  !mine.categories[3].questions[2].mediaType && !problems.some((p) => p.where === 'BIG THUNDER MOUNTAIN $600' && /screen|host|clip/.test(p.note)));

const fj = mine.finalJeopardy;
check('Final Jeopardy: its category and response',
  fj.category === 'NO-SHAVE NOVEMBER' && alike(fj.question, theirs.finalJeopardy.question) >= 0.6, JSON.stringify(fj));
check('its picture, played from the board from the title card to the answer',
  fj.mediaType === 'youtube' && Math.abs(fj.youtubeStart - theirs.finalJeopardy.youtubeStart) <= 2
  && Math.abs(fj.youtubeEnd - theirs.finalJeopardy.youtubeEnd) <= 3,
  JSON.stringify([fj.youtubeStart, fj.youtubeEnd]));
check('and its clue is left to a person, since a picture has no words to read',
  fj.answer.startsWith(TODO) && problems.some((p) => p.blocking && p.where === 'Final Jeopardy'));

// ---------- publishing ----------

check('a draft with a TODO in it will not publish', todosIn(file).length === 1, todosIn(file).join(' · '));
const finished = { ...file, board: { ...mine, finalJeopardy: { ...fj, answer: theirs.finalJeopardy.answer } } };
check('written, it passes every check the server makes on a house board',
  !todosIn(finished).length
  && validateBoardStructure(finished.board, { topic: 'disney' }).valid
  && publishProblem({ title: finished.title, board: normalizeBoard(finished.board, { topic: 'disney' }), topic: 'disney' }) === null);

// ---------- Episode 21: songs, reveals, and Final with a logo ----------

const ep21 = draftBoard(readEpisode(parseOcr(readFileSync(at('./video-board/fixtures/episode-21.ocr.jsonl'), 'utf8'))),
  { youtube: 'aMS9UidTUUY', names, show: 'Disney 100 Jeopardy', topic: 'disney' });
const songs = ep21.file.board.categories[2].questions;
const heard = [[221, 231], [403, 413], [565, 579], [759, 770], [954, 970]];
check('"Listen up" plays the song under its card, as sound only, until the answer',
  songs.every((q, i) => q.audioOnly && q.mediaType === 'youtube'
    && Math.abs(q.youtubeStart - heard[i][0]) <= 1 && q.youtubeEnd === heard[i][1]),
  JSON.stringify(songs.map((q) => [q.youtubeStart, q.youtubeEnd, q.audioOnly])));
check('"get this song mix started" names a song: its card is not a sound to play',
  !ep21.file.board.categories[0].questions[3].mediaType, JSON.stringify(ep21.file.board.categories[0].questions[3]));
const shown = ep21.file.board.categories.flatMap((c) => c.questions).filter((q) => q.mediaType && !q.audioOnly);
check('footage after the host has talked is the answer being shown, not a clip to play first',
  shown.length === 0, shown.map((q) => q.answer).join(' · '));
const princess = ep21.file.board.categories[4].questions[2];
check('an answer sliding in over the desk ("NSWER:") does not hide the card before it',
  /^Ron Clements and John Musker/.test(princess.answer) && /Princess/.test(princess.question), princess.answer);
check('"WHATIS" is read as "What is"', ep21.file.board.categories[3].questions[3].question === 'Who is Rod Serling?');
const fj21 = ep21.file.board.finalJeopardy;
check("Final's category is its own card, not the clue's first line, and its clue is the words",
  fj21.category === 'AVATAR' && /^In 2009's Avatar/.test(fj21.answer) && !fj21.mediaType, JSON.stringify(fj21));
check('nothing left to review', ep21.problems.length === 0, ep21.problems.map((p) => `${p.where}: ${p.note}`).join(' · '));

// ---------- Episode 188: the newer show, where not every answer is on screen ----------

const read188 = readEpisode(parseOcr(readFileSync(at('./video-board/fixtures/episode-188.ocr.jsonl'), 'utf8')));
const ep188 = draftBoard(read188, { youtube: 'LX_MS_sy4yg', names, show: 'Disney Jeopardy!', topic: 'disney' });
const cats188 = ep188.file.board.categories;
check('the board, not the answers, keeps count: all 25 clues, the poster ones with no answer bar too',
  cats188.map((c) => c.name).join('|') === "ROGER RABBIT|PRINCES|IT'S YOUR LINE|RIDE/QUEUE MUSIC|ZOOMED-IN POSTERS"
  && cats188[0].questions[1].question === 'What is Playing Patty Cake?' && cats188[1].questions[1].question === 'What is Nancy?',
  cats188.map((c) => c.questions.map((q) => q.question).join(', ')).join(' · '));
const posters = cats188[4].questions;
const zoomed = [[283, 291], [438, 448], [626, 638], [777, 786], [984, 991]];
check('a poster zoomed in on, straight off the board, is the clue, played up to the poster shown whole',
  posters.every((q, i) => q.mediaType === 'youtube' && !q.audioOnly
    && Math.abs(q.youtubeStart - zoomed[i][0]) <= 2 && q.youtubeEnd === zoomed[i][1]),
  JSON.stringify(posters.map((q) => [q.youtubeStart, q.youtubeEnd])));
check('the words it then shows are offered for the response a person writes',
  ep188.problems.some((p) => p.where === 'ZOOMED-IN POSTERS $200' && /ONWARD/.test(p.note))
  && ep188.problems.some((p) => p.where === 'ROGER RABBIT $800' && /HOLLYWOOD 1947/.test(p.note)));
check('ride music plays under its card, even with the host back before the answer',
  cats188[3].questions.every((q) => q.audioOnly && q.youtubeStart >= 248), JSON.stringify(cats188[3].questions.map((q) => [q.youtubeStart, q.youtubeEnd])));
check('a scene to finish the line of is a clip', cats188[2].questions.every((q) => q.mediaType === 'youtube' && !q.audioOnly));
check('a word read three ways does not lose its line, and a blank of dots is a blank',
  /^Prince Phillip first meets/.test(cats188[1].questions[0].answer) && /spare ____$/.test(cats188[0].questions[2].answer),
  cats188[1].questions[0].answer);
check('Final, with its title over two lines',
  ep188.file.board.finalJeopardy.category === 'ZOOTOPIA 2' && /Patrick Warburton/.test(ep188.file.board.finalJeopardy.answer));

// ---------- Episode 187: lyrics, a Daily Double, and Final over three films ----------

const ep187 = draftBoard(readEpisode(parseOcr(readFileSync(at('./video-board/fixtures/episode-187.ocr.jsonl'), 'utf8'))),
  { youtube: 'S-XkcKpUFKc', names, show: 'Disney Jeopardy!', topic: 'disney' });
const cats187 = ep187.file.board.categories;
check('"ANSWER THIS QUESTION" on a card is the card, not an answer fading in',
  /begins to answer this question from the Evil Queen/.test(cats187[4].questions[0].answer), cats187[4].questions[0].answer);
check("Final's category, three films on three lines, is the category, and its clue is the words",
  ep187.file.board.finalJeopardy.category === 'LADY & THE TRAMP, ENCANTO, ROGER RABBIT'
  && /^Coincidentally/.test(ep187.file.board.finalJeopardy.answer) && !ep187.file.board.finalJeopardy.mediaType,
  JSON.stringify(ep187.file.board.finalJeopardy));
check('lyrics filled in over a clip are offered in reading order',
  ep187.problems.some((p) => p.where === 'SIGN-OFF KARAOKE $200' && /JASMINE: A WONDROUS PLACE \/ TOGETHER: FOR YOU AND ME/.test(p.note)));
check('the Daily Double screens are not taken for a picture clue: the card after the wager is the clue',
  /^Sing the very last lines of Go the Distance/.test(cats187[2].questions[2].answer) && !cats187[2].questions[2].mediaType,
  cats187[2].questions[2].answer);

// ---------- Episode 186: a host known by his shirt, lyrics over the song, a Final of pictures ----------

const ep186 = draftBoard(readEpisode(parseOcr(readFileSync(at('./video-board/fixtures/episode-186.ocr.jsonl'), 'utf8'))),
  { youtube: 'FnWbzT6N9XI', names, show: 'Disney Jeopardy!', topic: 'disney' });
const cats186 = ep186.file.board.categories;
check('the host is known by what is on his shirt, so it is never offered as an answer',
  !ep186.problems.some((p) => /ZERO|BOTHERS/.test(p.note)), ep186.problems.filter((p) => /ZERO/.test(p.note)).map((p) => p.where).join(', '));
check('with no answer bar to come, the lyrics sung straight off the card are the answer, not a clip',
  cats186[1].questions.every((q) => !q.mediaType), JSON.stringify(cats186[1].questions.map((q) => q.youtubeStart)));
const fj186 = ep186.file.board.finalJeopardy;
check("a Final of pictures plays the pictures, and stops when the host is back, before the answers are shown",
  fj186.category === 'FANTASIA' && fj186.youtubeStart === 1228 && fj186.youtubeEnd === 1256, JSON.stringify(fj186));

// ---------- Episodes 184, 183 and 181: short cards, fan banners, choices, a Final with no answer bar ----------

const ep = (n, youtube) => {
  const read = readEpisode(parseOcr(readFileSync(at(`./video-board/fixtures/episode-${n}.ocr.jsonl`), 'utf8')));
  return { read, ...draftBoard(read, { youtube, names, show: 'Disney Jeopardy!', topic: 'disney' }) };
};
const ep184 = ep(184, '5Oeqwgn0e_k');
check('a short card with a date on it is a card, its Cyrillic twin letters ("EPCOТ") put back',
  ep184.file.board.categories[3].questions[3].answer === 'May 5th, 2005 Epcot', ep184.file.board.categories[3].questions[3].answer);
check('"singing this song" names a song, so its card is not played as a sound',
  !ep184.file.board.categories[4].questions[4].mediaType);

const ep183 = ep(183, 'CvDOvOxn4FI');
const tarzan = ep183.file.board.categories[0].questions;
check("a fan's banner and the name under it are not the clue",
  /^This song won Phil Collins/.test(tarzan[0].answer) && /^During the credits/.test(tarzan[2].answer), tarzan[0].answer);
check('a picture listed with its choices offers them for the clue, and plays the picture with them on it',
  /Choices: The Jungle Book, The Princess & the Frog, 101 Dalmatians$/.test(ep183.file.board.categories[4].questions[0].answer)
  && ep183.file.board.categories[4].questions[0].youtubeEnd - ep183.file.board.categories[4].questions[0].youtubeStart > 5,
  ep183.file.board.categories[4].questions[0].answer);
check('no host seen is not the host at second 0', !ep183.problems.some((p) => /0:01 to/.test(p.note)));

const ep181 = ep(181, '5SEdjgqITV4');
check("a fan's name on the banner itself (\"FAN CLUE: AVI\") costs the card no line",
  /^Legend has it that/i.test(ep181.file.board.categories[0].questions[1].answer), ep181.file.board.categories[0].questions[1].answer);
check('a Final whose answer is only shown in clips is still Final, with its response left to write',
  ep181.file.board.finalJeopardy?.category === 'FANTASIA 2000' && ep181.file.board.finalJeopardy.question.startsWith(TODO)
  && ep181.problems.some((p) => p.where === 'Final Jeopardy' && p.blocking));
check('an episode named only in a caption is known by it, but only as a last resort',
  ep181.read.episode === null && ep181.read.mentioned === 181);

const told = readEpisode(frames, { categories: ['A', 'B', 'C', 'D', 'E'] });
check('names given are the names used', told.names.join('') === 'ABCDE');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
