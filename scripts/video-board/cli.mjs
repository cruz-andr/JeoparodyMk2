/**
 * An episode video in, a draft board and a review list out; then, once the
 * draft has been looked over, the board published as a house board.
 *
 *   npm run video-board -- ~/Downloads/disney-ep41.mp4 --youtube <video id or link>
 *   npm run video-board -- publish ~/Downloads/disney-ep41-board/board.json
 *
 * Reading the video:
 *   --youtube <id|url>       the episode on YouTube, which clip clues play from
 *   --categories "A|B|..."   the category names, if they were not read right
 *   --out <dir>              where the draft goes (default: beside the video)
 *   --fresh                  read the video again rather than reuse the last reading
 *
 * It writes board.json (the draft), review.md (what to check, with the
 * second to find it at in the video), look/ (the frames those are on) and
 * cover.jpg (the video's YouTube thumbnail, the board's cover).
 * Fix board.json by hand, or run again with --categories; a TODO left in it
 * stops it publishing.
 *
 * Publishing:
 *   --slug <slug>   the board's address (default: disney-jeopardy-<episode>)
 *   --featured      put it in the Featured row
 *   --replace       overwrite a house board already at that slug
 *
 * Publishing writes server/houseBoards/<slug>.json, and its cover beside it
 * as <slug>.jpg; the board goes up when
 * that is merged and deployed. Mac only: the text recognition is the Mac's
 * own. Needs ffmpeg (brew install ffmpeg, or FFMPEG=/path/to/ffmpeg).
 */
import { execFile, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  clock, draftBoard, parseNames, parseOcr, readEpisode, todosIn, youtubeId,
} from './read.mjs';
import {
  normalizeBoard, publishProblem, validateBoardStructure,
} from '../../server/shared/boardFormat.js';

const here = dirname(fileURLToPath(import.meta.url));
const HOUSE = join(here, '../../server/houseBoards');

// What every board from the show says about itself.
const SHOW = {
  // The first hundred episodes were Disney 100 Jeopardy; past a hundred, the show is Disney Jeopardy!
  name: (episode) => (episode && episode <= 100 ? 'Disney 100 Jeopardy' : 'Disney Jeopardy!'),
  topic: 'disney',
  slug: (episode) => `disney-jeopardy-${episode}`,
  description: (episode) => `From Inside the Magic's Disney Jeopardy (Episode ${episode}), hosted by Bryan Perri.`,
};

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args.splice(i, 2)[1];
};
const has = (name) => {
  const i = args.indexOf(name);
  if (i !== -1) args.splice(i, 1);
  return i !== -1;
};
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

// ── Reading ─────────────────────────────────────────────────

async function readVideo(video, out, fresh) {
  const cached = join(out, 'ocr.jsonl');
  if (!fresh && existsSync(cached)) {
    console.log('Using the last reading of this video (--fresh to read it again).');
    return { text: readFileSync(cached, 'utf8'), frames: null };
  }
  if (process.platform !== 'darwin') fail('Reading a video needs a Mac: the text recognition is the Mac\'s own.');

  const frames = mkdtempSync(join(tmpdir(), 'video-board-'));
  console.log('Taking a frame a second...');
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  const took = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', video,
    '-vf', 'fps=1,scale=1280:-2', '-q:v', '3', join(frames, '%05d.jpg')], { stdio: 'inherit' });
  if (took.error?.code === 'ENOENT') fail('ffmpeg is not installed: brew install ffmpeg (or set FFMPEG to where it is).');
  if (took.status !== 0) fail('ffmpeg could not read the video.');

  const count = readdirSync(frames).filter((f) => f.endsWith('.jpg')).length;
  const workers = Math.max(1, Math.min(6, cpus().length - 2));
  const per = Math.ceil(count / workers);
  console.log(`Reading the text on ${count} frames, ${workers} at a time...`);
  const run = promisify(execFile);
  const parts = await Promise.all(Array.from({ length: workers }, (_, w) => {
    const first = w * per + 1, last = Math.min(count, (w + 1) * per);
    if (first > last) return { stdout: '' };
    return run('osascript', ['-l', 'JavaScript', join(here, 'ocr.jxa'), frames, String(first), String(last)],
      { maxBuffer: 256 * 1024 * 1024 });
  }));
  const text = parts.map((p) => p.stdout.trim()).filter(Boolean).join('\n') + '\n';
  writeFileSync(cached, text);
  return { text, frames };
}

/**
 * The video's YouTube thumbnail as the board's cover, 800 wide like a cover
 * put up from the board page. False when there is none to fetch.
 */
async function fetchCover(youtube, to) {
  for (const size of ['maxresdefault', 'hqdefault']) {
    const res = await fetch(`https://i.ytimg.com/vi/${youtube}/${size}.jpg`).catch(() => null);
    if (!res?.ok) continue;
    const raw = `${to}.full.jpg`;
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    const made = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw,
      '-vf', 'scale=800:-2', '-q:v', '4', to]);
    rmSync(raw, { force: true });
    if (made.status === 0) return true;
  }
  return false;
}

/**
 * The episode's number, from the top corner of its thumbnail ("#21", "188"):
 * the newer episodes never put it on screen.
 */
async function readThumbnail(cover) {
  const dir = mkdtempSync(join(tmpdir(), 'video-board-cover-'));
  try {
    copyFileSync(cover, join(dir, '00001.jpg'));
    const { stdout } = await promisify(execFile)('osascript', ['-l', 'JavaScript', join(here, 'ocr.jxa'), dir, '1', '1']);
    const boxes = parseOcr(stdout)[0]?.boxes ?? [];
    const corner = boxes.find((b) => b.y < 0.15 && b.x > 0.75 && /^#?\d{1,4}$/.test(b.text));
    return corner ? Number(corner.text.replace('#', '')) : null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeReview(out, file, problems, read) {
  const blocking = problems.filter((p) => p.blocking);
  const lines = [
    `# ${file.title}`,
    '',
    blocking.length
      ? `**${blocking.length} to fix before it can publish**, and ${problems.length - blocking.length} to check.`
      : `Nothing blocks publishing. ${problems.length} to check.`,
    '',
    'Each item says where in the video to look; the frame is in look/ under the same time.',
    '',
  ];
  for (const p of problems) lines.push(`- ${p.blocking ? '**Fix**' : 'Check'} · ${p.where} · ${clock(p.at)}: ${p.note}`);
  lines.push('', '## Every clue, and where it is', '');
  read.cells.forEach((col, c) => col.forEach((cl, r) => {
    const q = file.board.categories[c].questions[r];
    if (!cl) return;
    lines.push(`- ${file.board.categories[c].name} $${q.points} · ${clock(cl.at)} · answer at ${clock(cl.answerAt)}`
      + `${cl.clip ? ` · clip ${clock(cl.clip.start)} to ${clock(cl.clip.end)}` : ''}`);
  }));
  if (read.final) lines.push(`- Final Jeopardy · ${clock(read.final.at)} · answer at ${clock(read.final.answerAt)}`);
  lines.push('', 'Also worth a look everywhere: spelling the show got wrong on its cards, and names left in lower case.', '');
  writeFileSync(join(out, 'review.md'), lines.join('\n'));
}

async function draft() {
  const youtube = youtubeId(flag('--youtube'));
  const categories = flag('--categories')?.split('|').map((s) => s.trim()).filter(Boolean) ?? null;
  const outFlag = flag('--out');
  const fresh = has('--fresh');
  const video = args.find((a) => !a.startsWith('--'));
  if (!video) fail('Usage: npm run video-board -- <video file> --youtube <id or link> [--categories "A|B|C|D|E"]');
  if (!existsSync(video)) fail(`No such file: ${video}`);

  const out = resolve(outFlag ?? join(dirname(video), `${basename(video, extname(video))}-board`));
  mkdirSync(out, { recursive: true });

  const { text, frames } = await readVideo(resolve(video), out, fresh);
  const read = readEpisode(parseOcr(text), { categories });
  const names = parseNames(readFileSync(join(here, 'names.txt'), 'utf8'));
  const cover = youtube && await fetchCover(youtube, join(out, 'cover.jpg')) ? 'cover.jpg' : null;
  // The thumbnail's number, when it has one, is the episode's own; the video can mention others.
  read.episode = (cover ? await readThumbnail(join(out, cover)) : null) ?? read.episode ?? read.mentioned;
  const { file, problems } = draftBoard(read, {
    youtube,
    names,
    show: SHOW.name(read.episode),
    topic: SHOW.topic,
    description: read.episode ? SHOW.description(read.episode) : null,
  });
  if (!youtube) problems.unshift({ where: 'The board', at: 0, note: 'No --youtube was given, so clip clues have nothing to play.' });
  if (cover) file.cover = cover;
  else problems.push({ where: 'The cover', at: 0, note: 'No YouTube thumbnail was fetched, so the board will have no cover.' });

  // The frames each item is on, for whoever checks it.
  if (frames) {
    const look = join(out, 'look');
    mkdirSync(look, { recursive: true });
    const keep = new Set(problems.map((p) => p.at));
    for (const col of read.cells) for (const cl of col) if (cl) keep.add(cl.at);
    if (read.final) keep.add(read.final.at);
    for (const s of keep) {
      const from = join(frames, `${String(s + 1).padStart(5, '0')}.jpg`);
      if (existsSync(from)) copyFileSync(from, join(look, `${clock(s).replace(':', '-')}.jpg`));
    }
    rmSync(frames, { recursive: true, force: true });
  }

  writeFileSync(join(out, 'board.json'), `${JSON.stringify(file, null, 2)}\n`);
  writeReview(out, file, problems, read);

  const blocking = problems.filter((p) => p.blocking).length;
  console.log(`\n${file.title}: ${read.cells.flat().filter(Boolean).length} clues${read.final ? ' and Final Jeopardy' : ''}.`);
  console.log(blocking ? `${blocking} to fix and ${problems.length - blocking} to check:` : `${problems.length} to check:`);
  for (const p of problems) console.log(`  ${p.blocking ? 'fix  ' : 'check'} ${p.where} (${clock(p.at)}): ${p.note}`);
  console.log(`\nDraft: ${join(out, 'board.json')}\nReview: ${join(out, 'review.md')}`);
  console.log(`Then: npm run video-board -- publish ${join(out, 'board.json')}`);
}

// ── Publishing ──────────────────────────────────────────────

function publish() {
  const slugFlag = flag('--slug');
  const featured = has('--featured');
  const replace = has('--replace');
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) fail('Usage: npm run video-board -- publish <board.json> [--slug slug] [--featured]');
  const file = JSON.parse(readFileSync(path, 'utf8'));

  const todos = todosIn(file);
  if (todos.length) fail(`Still to write before it can publish:\n${todos.map((t) => `  ${t}`).join('\n')}`);

  // The same checks the server makes when it starts, so a bad file stops here, not in its log.
  const check = validateBoardStructure(file.board, { topic: file.topic ?? null });
  if (!check.valid) fail(check.errors.join('\n'));
  const board = normalizeBoard(file.board, { topic: file.topic ?? null });
  const problem = publishProblem({ title: file.title, board, topic: file.topic ?? null });
  if (problem) fail(problem);

  const episode = /Episode (\d+)/.exec(file.title)?.[1];
  const slug = slugFlag ?? (episode ? SHOW.slug(episode) : null);
  if (!slug) fail('Give it a --slug: the title has no episode number to make one from.');
  const target = join(HOUSE, `${slug}.json`);
  if (existsSync(target) && !replace) fail(`${slug} is already a house board. --replace to overwrite it.`);

  // The cover goes beside the board, named for it.
  let cover;
  if (file.cover) {
    const from = resolve(dirname(path), file.cover);
    if (!existsSync(from)) fail(`The cover ${from} is missing. Take "cover" out of board.json to publish without one.`);
    cover = `${slug}${extname(from).toLowerCase()}`;
    copyFileSync(from, join(HOUSE, cover));
  }

  writeFileSync(target, `${JSON.stringify({ ...file, featured: featured || Boolean(file.featured), cover, board }, null, 2)}\n`);
  console.log(`Wrote server/houseBoards/${slug}.json${cover ? ` and its cover, ${cover}` : ''}.`);
  console.log(`It goes up at /boards/${slug} once that is merged and deployed.`);
}

if (args[0] === 'publish') {
  args.shift();
  publish();
} else {
  await draft();
}
