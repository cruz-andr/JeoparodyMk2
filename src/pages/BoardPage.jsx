import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useUserStore } from '../stores';
import {
  copyBoard, coverUrl, getBoard, reportBoard, setCover, setVisibility,
} from '../services/api/boardsService';
import { publishProblem, REPORT_REASONS } from '@shared/boardFormat.js';
import { compressImage } from '../utils/imageCompressor';
import BoardMiniature from '../components/boards/BoardMiniature';
import '../components/boards/BoardsChrome.css';
import './BoardPage.css';

const CLUE_TOTAL = 30;

/* The dial, in the order a board moves through it. The description is what the
   choice actually does to other people, not a restatement of its name. */
const CHOICES = [
  { key: 'private', name: 'Only me', note: 'Nobody else can open the link.' },
  { key: 'unlisted', name: 'Anyone with the link', note: 'Send it to your room. Not listed, not searchable.' },
  { key: 'public', name: 'In Community Boards', note: 'Anyone can find it, play it, and make their own copy.' },
];

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
          <button className="plain-btn boards-back" onClick={() => navigate('/menu')}>
            &lsaquo; Menu
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
  const playable = written === CLUE_TOTAL;

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

  const notReady = board.isOwner
    ? publishProblem({ title: board.title, board: board.board })
    : null;

  return (
    <div className="board-page">
      <header className="boards-top">
        {/* A fixed destination, not history. Someone arriving from a shared
            link has nothing behind them to go back to. */}
        <button
          className="plain-btn boards-back"
          onClick={() => navigate(board.isOwner ? '/boards/mine' : '/menu')}
        >
          &lsaquo; {board.isOwner ? 'My Boards' : 'Menu'}
        </button>
        <span className="boards-top-title">Board</span>
        <span className="boards-top-spacer" />
      </header>

      <main className="boards-body board-main">
        <div className="board-head">
          <BoardMiniature
            board={board.board}
            size="large"
            label={`${written} of ${CLUE_TOTAL} clues written`}
          />

          <div className="board-head-text">
            <h1 className="board-title">{board.title || 'Untitled board'}</h1>

            <p className="board-by">
              {board.author?.signature ? (
                <img
                  className="board-sig"
                  src={board.author.signature}
                  alt={board.author.username}
                />
              ) : null}
              <span>{board.author?.username ? `@${board.author.username}` : 'Unknown'}</span>
              <span className="board-by-sep" />
              <span>{written} of {CLUE_TOTAL} clues</span>
              {board.visibility === 'public' && (
                <>
                  <span className="board-by-sep" />
                  <span>{board.plays.toLocaleString()} {board.plays === 1 ? 'play' : 'plays'}</span>
                </>
              )}
            </p>

            {board.description && <p className="board-desc">{board.description}</p>}

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
          </div>
        </div>

        <ol className="board-cats">
          {board.board.categories.map((category, i) => (
            <li key={i}>
              <span className="board-cat-name">{category.name || 'Unnamed'}</span>
              <span className="board-cat-count">
                {category.questions.filter((q) => q.answer?.trim() && q.question?.trim()).length} of 5
              </span>
            </li>
          ))}
        </ol>

        <div className="board-actions">
          <button
            className="btn-primary"
            disabled={!playable}
            onClick={() => navigate('/singleplayer', { state: { board: board.board, boardSlug: slug } })}
          >
            Play it solo
          </button>
          <button
            className="plain-btn board-action"
            disabled={!playable}
            onClick={() => navigate('/host', { state: { board: board.board, boardSlug: slug } })}
          >
            Host it in a room
          </button>
          {board.isOwner ? (
            <button
              className="plain-btn board-action"
              onClick={() => navigate(`/boards/${slug}/edit`)}
            >
              Edit
            </button>
          ) : board.visibility === 'public' && isAuthenticated ? (
            <button className="plain-btn board-action" onClick={makeCopy} disabled={busy}>
              Make my own copy
            </button>
          ) : null}
        </div>

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
                  <button className="plain-btn board-action" onClick={sendReport} disabled={!reason || busy}>
                    Send the report
                  </button>
                  <button className="plain-btn board-action" onClick={() => setReporting(false)}>
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
                <label className="plain-btn board-action board-cover-pick">
                  {board.hasCover ? 'Replace' : 'Add an image'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => pickCover(e.target.files?.[0])}
                    disabled={busy}
                  />
                </label>
                {board.hasCover && (
                  <button className="plain-btn board-action" onClick={removeCover} disabled={busy}>
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
                <button className="plain-btn board-link-copy" onClick={copyLink}>
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
