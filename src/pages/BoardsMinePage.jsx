import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../stores';
import { createBoard, deleteBoard, myBoards } from '../services/api/boardsService';
import BoardMiniature from '../components/boards/BoardMiniature';
import '../components/boards/BoardsChrome.css';
import './BoardsMinePage.css';

const CLUE_TOTAL = 30;

const WHERE = {
  private: 'Only you',
  unlisted: 'Anyone with the link',
  public: 'In Community Boards',
};

/**
 * A row needs the miniature, and the miniature needs the board itself, which
 * the list endpoint deliberately does not send. So the shelf draws from
 * clue_count instead: the first N cells filled, in board order.
 *
 * It is a summary rather than a map of which cells are missing, and that is
 * the right trade here. Sending thirty boards to draw thirty thumbnails would
 * make the shelf the heaviest page in the app.
 */
function boardFromCount(clueCount) {
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

export default function BoardsMinePage() {
  const navigate = useNavigate();
  const { token, isAuthenticated } = useUserStore();
  const [boards, setBoards] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const leaving = useRef(false);

  useEffect(() => {
    if (!isAuthenticated && !leaving.current) navigate('/signin', { replace: true });
  }, [isAuthenticated, navigate]);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await myBoards(token);
      setBoards(data.boards);
    } catch (err) {
      /* Deliberately does not fall back to an empty list. "Nothing on the
         shelf yet" is a claim about your boards, and making it because a
         request failed tells someone their work is gone when it is not. */
      setError(err.message);
      setBoards('failed');
    }
  }, [token]);

  useEffect(() => { if (token) load(); }, [token, load]);

  const startNew = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { slug } = await createBoard(token);
      navigate(`/boards/${slug}/edit`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async (slug) => {
    try {
      await deleteBoard(token, slug);
      setBoards((current) => current.filter((b) => b.slug !== slug));
    } catch (err) {
      setError(err.message);
    } finally {
      setConfirming(null);
    }
  };

  return (
    <div className="boards-page">
      <header className="boards-top">
        <button className="plain-btn boards-back" onClick={() => navigate('/profile')}>
          &lsaquo; Profile
        </button>
        <span className="boards-top-title">My Boards</span>
        <span className="boards-top-spacer" />
      </header>

      <main className="boards-body">
        {error && <p className="boards-error">{error}</p>}

        {boards === 'failed' ? (
          <button className="plain-btn boards-new" onClick={load}>Try again</button>
        ) : boards === null ? (
          /* No spinner. The shelf loads in a moment and a spinner that flashes
             for 200ms is more noticeable than the wait it is covering. */
          <p className="boards-quiet">Loading your boards.</p>
        ) : boards.length === 0 ? (
          <div className="boards-empty">
            <h1>Nothing on the shelf yet.</h1>
            <p>
              A board is six categories and thirty clues. Write it once, then send
              the link to whoever you want to play it, or keep it to yourself.
            </p>
            <button className="btn-primary" onClick={startNew} disabled={busy}>
              {busy ? 'Making it' : 'Start a board'}
            </button>
          </div>
        ) : (
          <>
            <div className="boards-head">
              <p className="boards-count">
                {boards.length} {boards.length === 1 ? 'board' : 'boards'}
              </p>
              <button className="plain-btn boards-new" onClick={startNew} disabled={busy}>
                {busy ? 'Making it' : 'Start a board'}
              </button>
            </div>

            <ul className="boards-list">
              {boards.map((board) => (
                <li key={board.slug} className="boards-item">
                  <button
                    className="plain-btn boards-row"
                    onClick={() => navigate(`/boards/${board.slug}/edit`)}
                  >
                    <BoardMiniature
                      board={boardFromCount(board.clueCount)}
                      label={`${board.clueCount} of ${CLUE_TOTAL} clues written`}
                    />
                    <span className="boards-row-main">
                      <span className="boards-row-name">
                        {board.title || 'Untitled board'}
                      </span>
                      {/* Each fact is its own span so a narrow screen breaks
                          between them rather than through one, which was
                          leaving "plays" alone on a second line. */}
                      <span className="boards-row-note">
                        <span>
                          {board.clueCount === CLUE_TOTAL
                            ? 'Finished'
                            : `${board.clueCount} of ${CLUE_TOTAL} clues`}
                        </span>
                        <span>{WHERE[board.visibility]}</span>
                        {board.visibility === 'public' && board.plays > 0 && (
                          <span>
                            {board.plays.toLocaleString()} {board.plays === 1 ? 'play' : 'plays'}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="boards-row-go">&rsaquo;</span>
                  </button>

                  {/* Deleting a board is the one thing here that cannot be
                      undone, so it asks in place rather than behind a dialog
                      that appears over what you were looking at. */}
                  {confirming === board.slug ? (
                    <span className="boards-confirm">
                      <span>Delete for good?</span>
                      <button className="plain-btn is-danger" onClick={() => remove(board.slug)}>
                        Delete
                      </button>
                      <button className="plain-btn" onClick={() => setConfirming(null)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      className="plain-btn boards-delete"
                      onClick={() => setConfirming(board.slug)}
                      aria-label={`Delete ${board.title || 'this board'}`}
                    >
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
