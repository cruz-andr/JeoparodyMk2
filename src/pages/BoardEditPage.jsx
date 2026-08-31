import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useUserStore } from '../stores';
import { useHostStore } from '../stores/hostStore';
import { boardToHost, hostToBoard } from '../stores/boardShape';
import { getBoard, saveBoard } from '../services/api/boardsService';
import { CLUE_COUNT, countClues, MAX_TITLE } from '@shared/boardFormat.js';
import QuestionEditor from '../components/setup/QuestionEditor';
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
  const { categories, questions, setCategories, setQuestions, reset } = useHostStore();

  const [title, setTitle] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | failed

  const timer = useRef(null);
  const pending = useRef(false);
  const finalJeopardy = useRef(null);

  useEffect(() => {
    if (!isAuthenticated) navigate('/signin', { replace: true });
  }, [isAuthenticated, navigate]);

  // ---- load once, into the store the editor already reads ----
  useEffect(() => {
    let cancelled = false;
    if (!token) return undefined;

    (async () => {
      try {
        const data = await getBoard(slug, token);
        if (cancelled) return;
        if (!data.isOwner) {
          /* Someone else's board is readable but not editable, and bouncing to
             its page is more useful than an error about permissions. */
          navigate(`/boards/${slug}`, { replace: true });
          return;
        }
        const host = boardToHost(data.board);
        finalJeopardy.current = data.board.finalJeopardy ?? null;
        setCategories(host.categories);
        setQuestions(host.questions);
        setTitle(data.title ?? '');
        setLoaded(true);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();

    return () => { cancelled = true; };
  }, [slug, token, navigate, setCategories, setQuestions]);

  /* The editor writes into hostStore, which host mode also uses. Leaving this
     page with a board still in there would hand the next Host session someone
     else's clues. */
  useEffect(() => () => reset(), [reset]);

  const save = useCallback(async (patch) => {
    setSaveState('saving');
    try {
      await saveBoard(token, slug, patch);
      setSaveState('saved');
    } catch (err) {
      setSaveState('failed');
      setError(err.message);
    }
  }, [token, slug]);

  // ---- autosave ----
  useEffect(() => {
    if (!loaded) return undefined;

    /* The first run after loading is the load itself echoing back through the
       store, not an edit. Saving it would mark a board as touched for opening
       it. */
    if (!pending.current) {
      pending.current = true;
      return undefined;
    }

    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      save({ title, board: hostToBoard(categories, questions, finalJeopardy.current) });
    }, SAVE_AFTER_MS);

    return () => clearTimeout(timer.current);
  }, [loaded, title, categories, questions, save]);

  // ---- leaving ----
  const leave = async (to) => {
    clearTimeout(timer.current);
    if (pending.current && loaded) {
      await save({ title, board: hostToBoard(categories, questions, finalJeopardy.current) });
    }
    navigate(to);
  };

  if (error && !loaded) {
    return (
      <div className="boards-page">
        <header className="boards-top">
          <button className="plain-btn boards-back" onClick={() => navigate('/boards/mine')}>
            &lsaquo; My Boards
          </button>
          <span className="boards-top-title">Edit</span>
          <span className="boards-top-spacer" />
        </header>
        <main className="boards-body"><p className="boards-error">{error}</p></main>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="boards-page">
        <header className="boards-top">
          <span className="boards-back" />
          <span className="boards-top-title">Edit</span>
          <span className="boards-top-spacer" />
        </header>
        <main className="boards-body"><p className="boards-quiet">Opening the board.</p></main>
      </div>
    );
  }

  const board = hostToBoard(categories, questions, finalJeopardy.current);
  const written = countClues(board);

  const SAVE_WORDS = {
    idle: 'Saved',
    saving: 'Saving',
    saved: 'Saved',
    failed: 'Not saved',
  };

  return (
    <div className="boards-page board-edit">
      <header className="boards-top">
        <button className="plain-btn boards-back" onClick={() => leave('/boards/mine')}>
          &lsaquo; My Boards
        </button>
        <span className="boards-top-title">Edit</span>
        <span className={`board-save is-${saveState}`}>{SAVE_WORDS[saveState]}</span>
      </header>

      <main className="boards-body board-edit-body">
        <div className="board-edit-head">
          <BoardMiniature board={board} label={`${written} of ${CLUE_COUNT} clues written`} />

          <label className="board-edit-title">
            <span className="board-edit-label">Title</span>
            <input
              value={title}
              maxLength={MAX_TITLE}
              placeholder="Name this board"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <span className="board-edit-count">
            {written} of {CLUE_COUNT} clues
          </span>
        </div>

        {error && <p className="boards-error">{error}</p>}

        {/* The existing editor, unchanged apart from being told this is a
            draft: a board that is not finished still has to save. */}
        <QuestionEditor
          heading="Write the clues"
          subheading="Six categories, five clues each. Everything saves as you type."
          requireComplete={false}
          onBack={() => leave('/boards/mine')}
          onNext={() => leave(`/boards/${slug}`)}
          nextLabel="Done"
        />
      </main>
    </div>
  );
}
