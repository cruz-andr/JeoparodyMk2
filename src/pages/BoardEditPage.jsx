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

/* One undo step per burst of typing, not per keystroke. Below about this and
   undo walks back letter by letter, which is not what anybody means by it. */
const UNDO_COALESCE_MS = 400;

const UNDO_DEPTH = 50;

export default function BoardEditPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { token, isAuthenticated } = useUserStore();

  /* The board is held here rather than in hostStore. hostStore belongs to host
     mode, and borrowing it meant this page had to remember to empty it on the
     way out or hand the next Host session someone else's clues. */
  const [board, setBoard] = useState(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | failed
  const [conflict, setConflict] = useState(null);
  const [undoDepth, setUndoDepth] = useState(0);
  const [justCleared, setJustCleared] = useState(null);

  const timer = useRef(null);
  const version = useRef(1);

  /* Only what changed gets sent. The PUT already treats an absent field as
     "leave it alone", so this is a client-side change and it takes editing a
     title back down from re-uploading the whole board, images and all. */
  const pending = useRef({});
  const current = useRef({ title: '', board: null });

  const past = useRef([]);
  const lastSnapshot = useRef(0);
  const clearedTimer = useRef(null);

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
          navigate(`/boards/${slug}`, { replace: true });
          return;
        }
        setBoard(data.board);
        setTitle(data.title ?? '');
        version.current = data.version ?? 1;
        current.current = { title: data.title ?? '', board: data.board };
        past.current = [];
        setUndoDepth(0);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();

    return () => { cancelled = true; };
  }, [slug, token, navigate]);

  const save = useCallback(async () => {
    const patch = pending.current;
    if (!Object.keys(patch).length) return;

    setSaveState('saving');
    try {
      const result = await saveBoard(token, slug, { ...patch, baseVersion: version.current });
      version.current = result.version ?? version.current + 1;
      pending.current = {};
      setSaveState('saved');
    } catch (err) {
      if (err.status === 409) {
        /* Somebody else, or another tab. Stop saving and let a person choose,
           rather than deciding for them which version survives. */
        clearTimeout(timer.current);
        setConflict(err.details ?? {});
        setSaveState('failed');
        return;
      }
      setSaveState('failed');
      setError(err.message);
    }
  }, [token, slug]);

  const queue = useCallback((patch) => {
    pending.current = { ...pending.current, ...patch };
    current.current = { ...current.current, ...patch };
    setSaveState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_AFTER_MS);
  }, [save]);

  // ---- undo ----

  /**
   * Snapshots rather than inverse commands.
   *
   * A board is one small object edited immutably, so a snapshot shares every
   * category the edit did not touch and costs a handful of pointers. Writing
   * an inverse for every field edit would be far more machinery than the
   * feature is worth.
   */
  const remember = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastSnapshot.current < UNDO_COALESCE_MS) return;
    lastSnapshot.current = now;

    past.current.push({ title: current.current.title, board: current.current.board });
    if (past.current.length > UNDO_DEPTH) past.current.shift();
    setUndoDepth(past.current.length);
  }, []);

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;
    setUndoDepth(past.current.length);
    /* The next edit after an undo should be its own step, not merged into the
       burst that was interrupted. */
    lastSnapshot.current = 0;

    setBoard(previous.board);
    setTitle(previous.title);
    setJustCleared(null);
    queue({ title: previous.title, board: previous.board });
  }, [queue]);

  const onBoardChange = useCallback((next) => {
    remember();
    setBoard(next);
    queue({ board: next });
  }, [remember, queue]);

  const onTitleChange = (next) => {
    remember();
    setTitle(next);
    queue({ title: next });
  };

  /* A destructive action is always its own undo step, never merged with the
     typing that happened just before it. */
  const onCleared = useCallback((what) => {
    clearTimeout(clearedTimer.current);
    setJustCleared(what);
    clearedTimer.current = setTimeout(() => setJustCleared(null), 8000);
  }, []);

  const beforeClear = useCallback(() => remember(true), [remember]);

  /* Bound to the window, and skipped while the cursor is in a field: the
     browser's own undo inside a text input is better than ours and taking it
     away would be a downgrade. Same guard SignatureCanvas uses. */
  useEffect(() => {
    const onKey = (event) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || event.key.toLowerCase() !== 'z' || event.shiftKey) return;

      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;

      event.preventDefault();
      undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  useEffect(() => () => {
    clearTimeout(timer.current);
    clearTimeout(clearedTimer.current);
  }, []);

  /* Closing the tab mid-edit. The browser will not wait for a request, so this
     is a warning rather than a save, and only when there is something to lose. */
  useEffect(() => {
    const warn = (event) => {
      if (!Object.keys(pending.current).length) return undefined;
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const leave = async (to) => {
    clearTimeout(timer.current);
    if (Object.keys(pending.current).length) await save();
    navigate(to);
  };

  // ---- conflict ----

  const takeTheirs = () => {
    setBoard(conflict.board);
    setTitle(conflict.title ?? '');
    version.current = conflict.version ?? version.current;
    current.current = { title: conflict.title ?? '', board: conflict.board };
    pending.current = {};
    past.current = [];
    setUndoDepth(0);
    setConflict(null);
    setSaveState('saved');
  };

  const keepMine = () => {
    version.current = conflict.version ?? version.current;
    setConflict(null);
    queue({ title: current.current.title, board: current.current.board });
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

  const written = countClues(board);
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

        <button
          className="plain-btn board-edit-undo"
          onClick={undo}
          disabled={!undoDepth}
          title="Undo the last change"
        >
          Undo
        </button>

        <button className="plain-btn board-edit-done" onClick={() => leave(`/boards/${slug}`)}>
          Done
        </button>
      </div>

      {conflict && (
        <div className="board-conflict" role="alert">
          <p className="board-conflict-say">
            This board was changed somewhere else, probably another tab. Saving
            has stopped so nothing is lost without you choosing it.
          </p>
          <div className="board-conflict-do">
            <button className="plain-btn ge-action" onClick={takeTheirs}>
              Load the other version
            </button>
            <button className="plain-btn ge-action" onClick={keepMine}>
              Keep what I have
            </button>
          </div>
        </div>
      )}

      {justCleared && (
        <p className="board-cleared" role="status">
          {justCleared === 'final' ? 'Final Jeopardy cleared.' : 'Clue cleared.'}{' '}
          <button className="plain-btn board-cleared-undo" onClick={undo}>Undo</button>
        </p>
      )}

      {error && <p className="boards-error">{error}</p>}

      <BoardGridEditor
        board={board}
        onChange={onBoardChange}
        onCleared={onCleared}
        onBeforeClear={beforeClear}
      />
    </>,
    <span className={`board-save is-${saveState}`}>{SAVE_WORDS[saveState]}</span>
  );
}
