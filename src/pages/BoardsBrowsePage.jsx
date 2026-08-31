import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUserStore } from '../stores';
import { browse, coverUrl } from '../services/api/boardsService';
import { TOPICS } from '@shared/boardFormat.js';
import BoardMiniature from '../components/boards/BoardMiniature';
import '../components/boards/BoardsChrome.css';
import './BoardsBrowsePage.css';

const CLUE_TOTAL = 30;

const TOPIC_NAMES = {
  history: 'History',
  'film-tv': 'Film & TV',
  music: 'Music',
  science: 'Science',
  sport: 'Sport',
  geography: 'Geography',
  wordplay: 'Wordplay',
  'food-drink': 'Food & Drink',
  games: 'Games',
  'everything-else': 'Everything Else',
};

const ROWS = [
  { key: 'featured', name: 'Featured', note: 'Picked by hand' },
  { key: 'popular', name: 'Popular', note: 'Most played' },
  { key: 'new', name: 'New this week', note: 'Just published' },
];

/* The clue_count is all a list carries, so a card draws the first N cells
   filled. A summary rather than a map of which are missing, which is the right
   trade: sending thirty boards to draw thirty thumbnails would make this the
   heaviest page in the app. */
function shapeFrom(clueCount) {
  let left = clueCount;
  return {
    categories: Array.from({ length: 6 }, () => ({
      questions: Array.from({ length: 5 }, () => {
        const written = left > 0;
        if (written) left -= 1;
        return written ? { answer: 'x', question: 'x' } : { answer: '', question: '' };
      }),
    })),
  };
}

function Card({ board, onOpen }) {
  const categories = board.categories?.length
    ? board.categories.join(' · ')
    : null;

  return (
    <button className="plain-btn bb-card" onClick={() => onOpen(board.slug)}>
      <span className="bb-cover">
        {board.hasCover ? (
          <img className="bb-cover-art" src={coverUrl(board.slug)} alt="" loading="lazy" />
        ) : (
          /* No image, and the board is the image. The most on-brand thing on
             the page rather than a placeholder waiting to be replaced. */
          <span className="bb-cover-board">
            <BoardMiniature board={shapeFrom(board.clueCount)} size="cover" label="" />
          </span>
        )}
        <span className="bb-band">
          {categories || board.title || 'Untitled board'}
        </span>
      </span>

      <span className="bb-card-body">
        <span className="bb-card-title">{board.title || 'Untitled board'}</span>
        <span className="bb-card-meta">
          {board.author?.signature ? (
            <img className="bb-card-sig" src={board.author.signature} alt="" />
          ) : null}
          <span>{board.author?.username ? `@${board.author.username}` : 'Unknown'}</span>
          <span className="bb-card-plays">
            {board.plays.toLocaleString()} {board.plays === 1 ? 'play' : 'plays'}
          </span>
        </span>
      </span>
    </button>
  );
}

export default function BoardsBrowsePage() {
  const navigate = useNavigate();
  const { token, isAuthenticated } = useUserStore();
  const [params, setParams] = useSearchParams();

  const topic = TOPICS.includes(params.get('topic')) ? params.get('topic') : null;
  const query = params.get('q') ?? '';

  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState(query);
  const searchTimer = useRef(null);

  const load = useCallback(async () => {
    setError('');
    try {
      /* Three requests rather than one, because they are three different
         questions and a single endpoint answering all of them would be a
         parameter that changes what the response means. */
      const results = await Promise.all(
        ROWS.map((row) => browse({ row: row.key, topic, q: query, limit: 12 }, token))
      );
      const loaded = ROWS
        .map((row, i) => ({ ...row, ...results[i] }))
        /* Featured falls back to most played when nobody has picked anything,
           which makes it Popular under another name. */
        .filter((row) => row.key !== 'featured' || row.curated)
        .filter((row) => row.boards?.length);

      /* And with a small library the rows are the same boards over again: the
         newest twelve are also the most played twelve, in a different order.
         Compared as a set rather than as a list on purpose, because the same
         ten boards shuffled is not a second row, it is the first row again.

         Both come back on their own once the library is bigger than a row. */
      const seen = new Set();
      const distinct = loaded.filter((row) => {
        const shape = row.boards.map((b) => b.slug).sort().join(',');
        if (seen.has(shape)) return false;
        seen.add(shape);
        return true;
      });

      /* One row left means the sorting is not telling anybody anything, so it
         stops pretending to. */
      if (distinct.length === 1) {
        distinct[0] = {
          ...distinct[0],
          name: 'Every board',
          note: `${distinct[0].boards.length} so far`,
        };
      }

      setRows(distinct);
    } catch (err) {
      setError(err.message);
      setRows('failed');
    }
  }, [topic, query, token]);

  useEffect(() => { load(); }, [load]);

  /* Typing narrows after a pause rather than on every letter: a request per
     keystroke is a request per keystroke, and the results flicker. */
  const onType = (value) => {
    setTyped(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (value.trim()) next.set('q', value.trim());
      else next.delete('q');
      setParams(next, { replace: true });
    }, 350);
  };

  useEffect(() => () => clearTimeout(searchTimer.current), []);

  const pickTopic = (key) => {
    const next = new URLSearchParams(params);
    if (key && key !== topic) next.set('topic', key);
    else next.delete('topic');
    setParams(next, { replace: true });
  };

  const anything = Array.isArray(rows) && rows.some((row) => row.boards?.length);
  const filtering = Boolean(topic || query);

  return (
    <div className="boards-page">
      <header className="boards-top">
        <button className="plain-btn boards-back" onClick={() => navigate('/menu')}>
          &lsaquo; Menu
        </button>
        <span className="boards-top-title">Community Boards</span>
        <span className="boards-top-spacer" />
      </header>

      <main className="boards-body bb-body">
        <div className="bb-tools">
          <input
            className="bb-search"
            value={typed}
            placeholder="Search boards, or a player"
            aria-label="Search Community Boards"
            onChange={(e) => onType(e.target.value)}
          />
          <button
            className="plain-btn bb-make"
            onClick={() => navigate(isAuthenticated ? '/boards/mine' : '/signin')}
          >
            Build a board
          </button>
        </div>

        {/* A row of words with the chosen one underlined, the way a newspaper
            marks a section. Not a ring of outlined pills. */}
        <nav className="bb-topics" aria-label="Topics">
          <button
            className={`plain-btn bb-topic ${!topic ? 'is-on' : ''}`}
            onClick={() => pickTopic(null)}
          >
            Everything
          </button>
          {TOPICS.map((key) => (
            <button
              key={key}
              className={`plain-btn bb-topic ${topic === key ? 'is-on' : ''}`}
              onClick={() => pickTopic(key)}
            >
              {TOPIC_NAMES[key]}
            </button>
          ))}
        </nav>

        {error && <p className="boards-error">{error}</p>}

        {rows === null ? (
          <p className="boards-quiet">Looking.</p>
        ) : rows === 'failed' ? (
          <button className="plain-btn bb-make" onClick={load}>Try again</button>
        ) : !anything ? (
          /* Two different nothings. Nobody has published anything yet, which
             is an invitation, or a filter matched nothing, which is a dead
             end you should be able to back out of. */
          <div className="bb-empty">
            {filtering ? (
              <>
                <h1>Nothing here.</h1>
                <p>No board matches that yet.</p>
                <button className="plain-btn bb-make" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                  Clear the filter
                </button>
              </>
            ) : (
              <>
                <h1>Nobody has published a board yet.</h1>
                <p>
                  Six categories and thirty clues, about anything you know more
                  about than most people. Yours would be the first one here.
                </p>
                <button
                  className="btn-primary"
                  onClick={() => navigate(isAuthenticated ? '/boards/mine' : '/signup')}
                >
                  Build the first one
                </button>
              </>
            )}
          </div>
        ) : (
          rows.map((row) => (
            <section className="bb-row" key={row.key}>
              <div className="bb-row-head">
                <h2>{row.name}</h2>
                <span className="bb-row-note">{row.note}</span>
              </div>
              <div className="bb-cards">
                {row.boards.map((board) => (
                  <Card key={board.slug} board={board} onOpen={(slug) => navigate(`/boards/${slug}`)} />
                ))}
              </div>
            </section>
          ))
        )}

        <p className="bb-foot">
          Boards here are written by players.{' '}
          <button className="plain-btn bb-foot-link" onClick={() => navigate('/guidelines')}>
            What is allowed
          </button>
        </p>
      </main>
    </div>
  );
}

export { TOPIC_NAMES, CLUE_TOTAL };
