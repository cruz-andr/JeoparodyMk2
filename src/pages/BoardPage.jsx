import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePageTitle } from '../hooks/usePageTitle';
import { useUserStore } from '../stores';
import {
  browse, copyBoard, coverUrl, getBoard, reportBoard, setCover, setVisibility,
} from '../services/api/boardsService';
import { CLUE_COUNT, clueTarget, publishProblem, REPORT_REASONS } from '@shared/boardFormat.js';
import { compressImage } from '../utils/imageCompressor';
import BoardMiniature from '../components/boards/BoardMiniature';
import { Card, Rail } from '../components/boards/Shelf';
import { TOPIC_NAMES } from './BoardsBrowsePage';
import '../components/boards/BoardsChrome.css';
import './BoardPage.css';


/* The dial, in the order a board moves through it. The description is what the
   choice actually does to other people, not a restatement of its name. */
const CHOICES = [
  { key: 'private', name: 'Only me', note: 'Nobody else can open the link.' },
  { key: 'unlisted', name: 'Anyone with the link', note: 'Send it to your room. Not listed, not searchable.' },
  { key: 'public', name: 'In Community Boards', note: 'Anyone can find it, play it, and make their own copy.' },
];

/* What a category holds, without saying a word of it: the way a show's
   episode list tells you what is in an episode and not how it ends. */
function holds(category) {
  const qs = category.questions.filter((q) => q.answer?.trim() && q.question?.trim());
  const clips = qs.filter((q) => q.mediaType === 'youtube' && !q.audioOnly).length;
  const sounds = qs.filter((q) => q.mediaType === 'youtube' && q.audioOnly).length;
  const pictures = qs.filter((q) => q.mediaType === 'image').length;
  return [
    `${qs.length} ${qs.length === 1 ? 'clue' : 'clues'}`,
    clips && `${clips} ${clips === 1 ? 'clip' : 'clips'}`,
    sounds && `${sounds} to listen to`,
    pictures && `${pictures} ${pictures === 1 ? 'picture' : 'pictures'}`,
  ].filter(Boolean).join(' \u00b7 ');
}

/**
 * Below a board, more to play: the rest of the series for one of the show's
 * episodes (the house's boards, newest first), or more on the same topic.
 */
function More({ board, slug, token, onOpen }) {
  const series = !board.author;
  const [boards, setBoards] = useState(null);

  useEffect(() => {
    let live = true;
    const ask = series
      ? browse({ row: 'house', limit: 48 }, token)
      : browse({ row: 'popular', topic: board.topic ?? undefined, limit: 24 }, token);
    ask.then((r) => live && setBoards((r.boards ?? []).filter((b) => b.slug !== slug)))
      .catch(() => live && setBoards([]));
    return () => { live = false; };
  }, [series, board.topic, slug, token]);

  if (!boards?.length) return null;
  return (
    <section className="bp-section bp-more">
      <h2>{series ? 'More episodes' : 'More like this'}</h2>
      <Rail>
        {boards.map((b) => <Card key={b.slug} board={b} onOpen={onOpen} />)}
      </Rail>
    </section>
  );
}

export default function BoardPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { token, isAuthenticated } = useUserStore();

  const [board, setBoard] = useState(null);
  const [error, setError] = useState('');
  const [dialError, setDialError] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  usePageTitle(board ? (board.title || 'Untitled board') : 'Community Boards');

  const load = useCallback(async () => {
    try {
      setBoard(await getBoard(slug, token));
    } catch (err) {
      setError(err.message);
    }
  }, [slug, token]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="board-page">
        <header className="boards-top">
          <button className="plain-btn boards-back back-chevron" onClick={() => navigate('/menu')} aria-label="Back to menu" title="Back to menu">
            &lsaquo;
          </button>
          <span className="boards-top-title">Board</span>
          <span className="boards-top-spacer" />
        </header>
        <main className="boards-body">
          <div className="board-gone">
            <h1>{error}</h1>
            <p>
              The link may be wrong, or whoever made this board may have taken it
              down or made it private again.
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (!board) {
    return <div className="board-page" />;
  }

  const written = board.board
    ? board.board.categories.reduce(
        (n, c) => n + c.questions.filter((q) => q.answer?.trim() && q.question?.trim()).length,
        0
      )
    : board.clueCount;
  /* Thirty, or twenty-five on a five-category Disney board. */
  const total = board.board ? clueTarget(board.board) : (board.clueTotal ?? CLUE_COUNT);
  const playable = written === total;

  const change = async (visibility) => {
    setDialError('');
    setBusy(true);
    try {
      await setVisibility(token, slug, visibility);
      await load();
    } catch (err) {
      setDialError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/boards/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* Clipboard access can be refused, and there is nothing useful to say
         about it. Select the link instead so it can be copied by hand. */
      const field = document.getElementById('board-link');
      field?.select?.();
    }
  };

  const makeCopy = async () => {
    setBusy(true);
    try {
      const { slug: mine } = await copyBoard(token, slug);
      navigate(`/boards/${mine}/edit`);
    } catch (err) {
      setDialError(err.message);
      setBusy(false);
    }
  };

  const sendReport = async () => {
    if (!reason) return;
    setBusy(true);
    setDialError('');
    try {
      await reportBoard(token, slug, reason, note);
      setReported(true);
      setReporting(false);
    } catch (err) {
      setDialError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const pickCover = async (file) => {
    if (!file) return;
    setDialError('');
    setBusy(true);
    try {
      /* The same 800px WebP the clue editor uses, so a cover cannot be the one
         thing on the site somebody uploads a four megabyte photograph to. */
      const compressed = await compressImage(file, 1200, 0.72);
      await setCover(token, slug, compressed);
      await load();
    } catch (err) {
      setDialError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeCover = async () => {
    setBusy(true);
    try {
      await setCover(token, slug, null);
      await load();
    } catch (err) {
      setDialError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /* One of the show's episodes is titled the way a series is: the show in
     big letters, the episode over it ("Disney Jeopardy!: Episode 188").
     Anybody else's board is its own title, over what it is about. */
  const [show, part] = !board.author && board.title?.includes(': ')
    ? [board.title.slice(0, board.title.indexOf(': ')), board.title.slice(board.title.indexOf(': ') + 2)]
    : [board.title, null];
  const kicker = part ?? TOPIC_NAMES[board.topic] ?? null;

  const notReady = board.isOwner
    ? publishProblem({ title: board.title, board: board.board, topic: board.topic })
    : null;

  return (
    <div className="board-page">
      <header className="boards-top">
        {/* A fixed destination, not history. Someone arriving from a shared
            link has nothing behind them to go back to. */}
        <button
          className="plain-btn boards-back back-chevron"
          onClick={() => navigate(board.isOwner ? '/boards/mine' : '/menu')}
          aria-label={board.isOwner ? 'Back to My Boards' : 'Back to menu'}
          title={board.isOwner ? 'Back to My Boards' : 'Back to menu'}
        >
          &lsaquo;
        </button>
        <span className="boards-top-title">Board</span>
        <span className="boards-top-spacer" />
      </header>

      {/* The cover is the poster: across the top, the way a film's page opens
          on its key art, with the title and the way in over it. */}
      <section className={`bp-hero ${board.hasCover ? 'has-cover' : ''}`}>
        <div className="bp-hero-art" aria-hidden="true">
          {board.hasCover ? (
            <img src={`${coverUrl(slug)}?v=${board.version}`} alt="" />
          ) : (
            <span className="bp-hero-board">
              <BoardMiniature board={board.board} size="cover" label="" />
            </span>
          )}
        </div>

        <div className="bp-hero-text">
          {kicker && <p className="bp-kicker">{kicker}</p>}
          <h1 className="bp-title board-title">{show || 'Untitled board'}</h1>

          <p className="board-by bp-meta">
            {board.author?.signature ? (
              <img className="board-sig" src={board.author.signature} alt={board.author.username} />
            ) : null}
            {/* The site's own boards have no author to name. */}
            {board.author?.username && (
              <>
                <span>@{board.author.username}</span>
                <span className="board-by-sep" />
              </>
            )}
            <span>{written} of {total} clues</span>
            {board.visibility === 'public' && (
              <>
                <span className="board-by-sep" />
                <span>{board.plays.toLocaleString()} {board.plays === 1 ? 'play' : 'plays'}</span>
              </>
            )}
          </p>

          {board.description && <p className="bp-desc">{board.description}</p>}

          {/* board-actions: the browser suites find the Play button by it. */}
          <div className="board-actions bp-actions">
            <button
              className="btn-primary bp-play"
              disabled={!playable}
              onClick={() => navigate('/singleplayer', { state: { board: board.board, boardSlug: slug, title: board.title } })}
            >
              {/* Drawn, not the ▶ character, which some systems show as a colour emoji. */}
              <span className="bp-play-mark" aria-hidden="true"><svg viewBox="0 0 10 12" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"><path d="M0 0L10 6L0 12Z" /></svg></span> Play
            </button>
            {/* A private room plays it together. Not a private board: everyone
                in the room would be sent its clues. */}
            {board.visibility !== 'private' && (
              <button
                className="plain-btn bp-more-way board-play-friends"
                disabled={!playable}
                onClick={() => navigate('/multiplayer', { state: { board: { slug, title: board.title } } })}
              >
                Play with friends
              </button>
            )}
            <button
              className="plain-btn bp-more-way"
              disabled={!playable}
              onClick={() => navigate('/host', { state: { board: board.board, boardSlug: slug } })}
            >
              Host it in a room
            </button>
            {board.isOwner ? (
              <button className="plain-btn bp-more-way" onClick={() => navigate(`/boards/${slug}/edit`)}>
                Edit
              </button>
            ) : board.visibility === 'public' && isAuthenticated ? (
              <button className="plain-btn bp-more-way" onClick={makeCopy} disabled={busy}>
                Make my own copy
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <main className="boards-body board-main">
        {board.adaptedFrom && (
          <p className="board-adapted">
            Adapted from {board.adaptedFrom.slug ? (
              <a href={`/boards/${board.adaptedFrom.slug}`}>
                {board.adaptedFrom.title || 'a board'}
              </a>
            ) : (
              board.adaptedFrom.title || 'a board'
            )} by @{board.adaptedFrom.username}
          </p>
        )}

        {/* The categories as a show's episodes: numbered, named, and what is
            in each, never what it asks. */}
        <section className="bp-section">
          <h2>Categories</h2>
          <ol className="bp-episodes">
            {board.board.categories.map((category, i) => (
              <li key={i}>
                <span className="bp-ep-num">{i + 1}</span>
                <span className="bp-ep-text">
                  <span className="bp-ep-name">{category.name || 'Unnamed'}</span>
                  <span className="bp-ep-holds">{holds(category)}</span>
                </span>
              </li>
            ))}
            {board.board.finalJeopardy?.category?.trim() && (
              <li className="is-final">
                <span className="bp-ep-num">F</span>
                <span className="bp-ep-text">
                  <span className="bp-ep-name">{board.board.finalJeopardy.category}</span>
                  <span className="bp-ep-holds">Final Jeopardy</span>
                </span>
              </li>
            )}
          </ol>
        </section>

        <More board={board} slug={slug} token={token} onOpen={(next) => navigate(`/boards/${next}`)} />

        {/* Quiet, at the bottom, and only on a board that is actually public
            and not yours. A report button on an unlisted board would be a
            report button on something somebody sent you. */}
        {!board.isOwner && board.visibility === 'public' && (
          <div className="board-report">
            {reported ? (
              <p className="board-report-done">
                Reported. Somebody will read it. Nothing comes down
                automatically, which is the only thing we can honestly promise.
              </p>
            ) : !reporting ? (
              <button
                className="plain-btn board-report-open"
                onClick={() => (isAuthenticated ? setReporting(true) : navigate('/signin'))}
              >
                Report this board
              </button>
            ) : (
              <div className="board-report-form">
                <p className="board-report-why">Why are you reporting it?</p>
                <ul className="board-dial">
                  {REPORT_REASONS.map((r) => (
                    <li key={r.key}>
                      <button
                        className={`plain-btn board-choice ${reason === r.key ? 'is-on' : ''}`}
                        aria-pressed={reason === r.key}
                        onClick={() => setReason(r.key)}
                      >
                        <span className="board-choice-name">{r.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <textarea
                  className="board-report-note"
                  value={note}
                  maxLength={500}
                  placeholder="Anything else worth knowing (optional)"
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="board-report-do">
                  <button className="plain-btn quiet-action board-action" onClick={sendReport} disabled={!reason || busy}>
                    Send the report
                  </button>
                  <button className="plain-btn quiet-action board-action" onClick={() => setReporting(false)}>
                    Never mind
                  </button>
                </div>
                <p className="board-report-rules">
                  <button className="plain-btn bb-foot-link" onClick={() => navigate('/guidelines')}>
                    What is allowed here
                  </button>
                </p>
              </div>
            )}
          </div>
        )}

        {!playable && (
          <p className="board-incomplete">
            This board is not finished, so it cannot be played yet.
            {board.isOwner && ' The empty cells are marked in the editor.'}
          </p>
        )}

        {board.isOwner && (
          <section className="board-share">
            <h2>The cover</h2>
            <div className="board-cover">
              <span className="board-cover-shot">
                {board.hasCover ? (
                  <img src={`${coverUrl(slug)}?v=${board.version}`} alt="" />
                ) : (
                  <span className="board-cover-none">
                    <BoardMiniature board={board.board} size="cover" label="" />
                  </span>
                )}
                <span className="board-cover-band">
                  {board.board.categories.map((c) => c.name).filter(Boolean).join(' \u00b7 ')
                    || 'Name your categories'}
                </span>
              </span>
              <div className="board-cover-do">
                <label className="plain-btn quiet-action board-action board-cover-pick">
                  {board.hasCover ? 'Replace' : 'Add an image'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => pickCover(e.target.files?.[0])}
                    disabled={busy}
                  />
                </label>
                {board.hasCover && (
                  <button className="plain-btn quiet-action board-action" onClick={removeCover} disabled={busy}>
                    Remove
                  </button>
                )}
                <p className="board-cover-note">
                  Optional. Your categories sit across the bottom either way, so
                  a board without an image still looks like a board.
                </p>
              </div>
            </div>

            <h2 className="board-share-second">Who can see this</h2>

            <ul className="board-dial">
              {CHOICES.map((choice) => {
                const blocked = choice.key === 'public' && Boolean(notReady);
                const on = board.visibility === choice.key;

                return (
                  <li key={choice.key}>
                    <button
                      className={`plain-btn board-choice ${on ? 'is-on' : ''}`}
                      aria-pressed={on}
                      disabled={busy || blocked}
                      onClick={() => change(choice.key)}
                    >
                      <span className="board-choice-name">{choice.name}</span>
                      <span className="board-choice-note">
                        {blocked ? notReady : choice.note}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {dialError && <p className="board-dial-error">{dialError}</p>}

            {board.visibility !== 'private' && (
              <div className="board-link">
                <label className="board-link-label" htmlFor="board-link">The link</label>
                <input
                  id="board-link"
                  className="board-link-field"
                  readOnly
                  value={`${window.location.origin}/boards/${slug}`}
                  onFocus={(e) => e.target.select()}
                />
                <button className="plain-btn quiet-action board-link-copy" onClick={copyLink}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
