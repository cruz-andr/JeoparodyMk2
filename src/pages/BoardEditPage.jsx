import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useUserStore } from '../stores';
import { getBoard, saveBoard } from '../services/api/boardsService';
import { CLUE_COUNT, countClues, MAX_TITLE } from '@shared/boardFormat.js';
import BoardGridEditor from '../components/boards/BoardGridEditor';
import BoardMiniature from '../components/boards/BoardMiniature';
import '../components/boards/BoardsChrome.css';
import './BoardEditPage.css';

/* Long enough that typing a clue is one save rather than forty, short enough
   that nobody closes a tab inside the window. */
const SAVE_AFTER_MS = 1200;

export default function BoardEditPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { token, isAuthenticated } = useUserStore();

  /* The board is held here rather than in hostStore.
     hostStore belongs to host mode, and borrowing it meant this page had to
     remember to empty it on the way out or hand the next Host session someone
     else's clues. A board is the page's own state, so it is. */
  const [board, setBoard] = useState(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | failed

  const timer = useRef(null);
  const dirty = useRef(false);
  const latest = useRef({ title: '', board: null });

  useEffect(() => {
    if (!isAuthenticated) navigate('/signin', { replace: true });
  }, [isAuthenticated, navigate]);

  // ---- load ----
  useEffect(() => {
    let cancelled = false;
    if (!token) return undefined;

    (async () => {
      try {
        const data = await getBoard(slug, token);
        if (cancelled) return;
        if (!data.isOwner) {
          /* Someone else's board is readable but not editable, and its own page
             is more use than an error about permissions. */
          navigate(`/boards/${slug}`, { replace: true });
          return;
        }
        setBoard(data.board);
        setTitle(data.title ?? '');
        latest.current = { title: data.title ?? '', board: data.board };
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();

    return () => { cancelled = true; };
  }, [slug, token, navigate]);

  const save = useCallback(async () => {
    setSaveState('saving');
    try {
      await saveBoard(token, slug, latest.current);
      dirty.current = false;
      setSaveState('saved');
    } catch (err) {
      setSaveState('failed');
      setError(err.message);
    }
  }, [token, slug]);

  // ---- autosave ----
  const touch = useCallback((next) => {
    latest.current = { ...latest.current, ...next };
    dirty.current = true;
    setSaveState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_AFTER_MS);
  }, [save]);

  const onBoardChange = useCallback((next) => {
    setBoard(next);
    touch({ board: next });
  }, [touch]);

  const onTitleChange = (next) => {
    setTitle(next);
    touch({ title: next });
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  /* Closing the tab mid-edit. The browser will not wait for a request, so this
     is a warning rather than a save, and only when there is something to lose. */
  useEffect(() => {
    const warn = (event) => {
      if (!dirty.current) return undefined;
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const leave = async (to) => {
    clearTimeout(timer.current);
    if (dirty.current) await save();
    navigate(to);
  };

  // ---- shells ----
  const shell = (backTo, backLabel, body, right = null) => (
    <div className="boards-page board-edit">
      <header className="boards-top">
        {backTo ? (
          <button className="plain-btn boards-back" onClick={() => leave(backTo)}>
            &lsaquo; {backLabel}
          </button>
        ) : <span className="boards-back" />}
        <span className="boards-top-title">Edit</span>
        {right ?? <span className="boards-top-spacer" />}
      </header>
      <main className="boards-body board-edit-body">{body}</main>
    </div>
  );

  if (error && !board) {
    return shell('/boards/mine', 'My Boards', <p className="boards-error">{error}</p>);
  }

  if (!board) {
    return shell(null, '', <p className="boards-quiet">Opening the board.</p>);
  }

  const written = countClues({ ...board, categories: board.categories });

  const SAVE_WORDS = { idle: 'Saved', saving: 'Saving', saved: 'Saved', failed: 'Not saved' };

  return shell(
    '/boards/mine',
    'My Boards',
    <>
      <div className="board-edit-head">
        <BoardMiniature board={board} label={`${written} of ${CLUE_COUNT} clues written`} />

        <label className="board-edit-title">
          <span className="board-edit-label">Title</span>
          <input
            value={title}
            maxLength={MAX_TITLE}
            placeholder="Name this board"
            onChange={(e) => onTitleChange(e.target.value)}
          />
        </label>

        <span className="board-edit-count">{written} of {CLUE_COUNT} clues</span>

        <button className="plain-btn board-edit-done" onClick={() => leave(`/boards/${slug}`)}>
          Done
        </button>
      </div>

      {error && <p className="boards-error">{error}</p>}

      <BoardGridEditor board={board} onChange={onBoardChange} />
    </>,
    <span className={`board-save is-${saveState}`}>{SAVE_WORDS[saveState]}</span>
  );
}
