import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../hooks';
import { useHostStore } from '../stores/hostStore';
import { useRoomStore, useSettingsStore, useUserStore } from '../stores';
import { roomRulesFromSettings } from '../stores/settingsStore';
import { hostToBoard, boardToHost } from '../stores/boardShape';
import socketClient from '../services/socket/socketClient';
import * as aiService from '../services/api/aiService';
import { emptyBoard, countClues, POINT_VALUES } from '@shared/boardFormat.js';
import { finalState, toggleDouble } from '../components/boards/gridLogic';
import BoardGridEditor from '../components/boards/BoardGridEditor';
import HostSettingsSheet from '../components/host/HostSettingsSheet';
import HostFillPanel from '../components/host/HostFillPanel';
import Icon from '../components/common/Icon';
import './HostPage.css';

const DOUBLE_VALUES = [400, 800, 1200, 1600, 2000];

/**
 * What went wrong with the model, in words a host can act on.
 *
 * The service throws whatever the SDK or the network handed it, and somebody
 * who asked for a board about rivers should not be told about an environment
 * variable. Each of these says what to do next, because writing the board by
 * hand is always still open.
 */
function aiTrouble(err) {
  const raw = String(err?.message ?? '');
  /* The model now answers through the server, which asks who is asking. */
  if (/sign in/i.test(raw)) {
    return 'Sign in to have the AI write the board, or write it yourself.';
  }
  if (/API[_ ]?key|not set|invalid key|401|403|PERMISSION/i.test(raw)) {
    return 'The AI is not set up on this site. Write the board yourself, upload a file, or duplicate a community board.';
  }
  if (/quota|rate limit|429|RESOURCE_EXHAUSTED|exhausted/i.test(raw)) {
    return 'The AI is out of requests for now. Try again in a few minutes, or write the board yourself.';
  }
  if (/network|failed to fetch|ECONN|timeout|abort/i.test(raw)) {
    return 'Could not reach the AI. Check your connection and try again.';
  }
  if (/JSON|parse|unexpected token/i.test(raw)) {
    return 'The AI sent back something unusable. Try again, or write the board yourself.';
  }
  return 'Could not write the board. Try again, or write it yourself.';
}

/** Round two is the same board at twice the money. */
function doubledBoard() {
  const board = emptyBoard();
  board.categories.forEach((category) => {
    category.questions.forEach((question, r) => { question.points = DOUBLE_VALUES[r]; });
  });
  return board;
}

/**
 * Host mode, on one screen.
 *
 * It used to be six: settings, then how to make questions, then a genre, then
 * the categories, then the clues, then a room. The first of those asked you to
 * set a timer before you had said what the game was about, which is the wrong
 * question at the wrong moment, and the room code only existed once you had
 * been through all of them.
 *
 * Now there is one screen. Everything about what the game IS happens on the
 * board. Everything about how it is PLAYED is behind Game Settings in the
 * corner. The room exists from the first second, so people can join while you
 * are still writing.
 */
export default function HostPage() {
  const navigate = useNavigate();
  const { isConnected } = useSocket();

  const { token } = useUserStore();
  /* Read from the store rather than counted separately, so the number on screen
     and the people the game will start with are the same list. */
  const settings = useSettingsStore();
  const {
    answerMode, projectorMode,
    setCategories, setQuestions, reset: resetHost,
  } = useHostStore();

  /* The boards live here in the shared board format, not in hostStore's two
     parallel arrays. hostStore is what the game reads, so it is filled in on
     the way out rather than edited in place. */
  const [rounds, setRounds] = useState(() => ({ 1: emptyBoard(), 2: doubledBoard() }));
  const [final, setFinal] = useState(null);
  const [round, setRound] = useState(1);

  const [showSettings, setShowSettings] = useState(false);
  const [fill, setFill] = useState(null); // 'ai' | 'file' | 'board'
  /* What the model is doing right now, so the board can say so instead of
     sitting there looking finished and wrong. */
  const [writing, setWriting] = useState(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  /* What the board was generated from, and how many re-rolls are left on it.
     Both are per round: two rounds can come from two different topics. */
  const [topics, setTopics] = useState({ 1: '', 2: '' });
  const [rerolls, setRerolls] = useState({ 1: 5, 2: 5 });
  /* Which cells the host marked, per round, when they chose to place the Daily
     Doubles themselves. Empty means the server picks, which is what has always
     happened. */
  const [doubles, setDoubles] = useState({ 1: [], 2: [] });
  const [marking, setMarking] = useState(false);


  useEffect(() => () => resetHost(), [resetHost]);

  /* No room is opened here.

     This screen used to create one the moment it loaded, so a code existed for
     a game that did not, "Create game" created nothing because the room was
     already made, and every visit to this page left a room behind whether or
     not a game followed. The room is made when the host creates the game, and
     the lobby is where its code lives. */

  // ------------------------------------------------------------- the board

  const board = rounds[round];
  const onBoardChange = useCallback((next) => {
    setRounds((all) => ({ ...all, [round]: next }));
  }, [round]);

  const written = useMemo(() => ({
    1: countClues(rounds[1]),
    2: countClues(rounds[2]),
  }), [rounds]);

  const doubleOn = settings.enableDoubleJeopardy;
  const finalOn = settings.enableFinalJeopardy;
  const finalIs = finalState({ finalJeopardy: final });

  /* Placing them by hand is only on offer when Daily Doubles are on and the
     host asked for it in Game Settings. */
  const placing = settings.enableDailyDouble && settings.dailyDoublePlacement === 'chosen';
  const wanted = round === 2 ? 2 : 1;
  /* Only drawn while the host is placing them. The marks are kept rather than
     thrown away, so turning it off and on again gives back what they placed,
     but a marker on screen has to mean the game will use it. */
  const placed = placing && typeof round === 'number' ? doubles[round] ?? [] : [];

  /* Only on the round being written. Switching tabs mid write shows the other
     round as it is, rather than claiming that one is being written too. */
  const atWork = writing && writing.round === (round === 2 ? 2 : 1) && round !== 'final';

  /* Marking is a mode on one board, so it ends when that board leaves the
     screen. A host who switches to Double Jeopardy is usually going there to
     write it, and their first click landing a marker instead of opening a clue
     is the kind of surprise a mode has to avoid. */
  useEffect(() => { setMarking(false); }, [round]);
  useEffect(() => { if (!placing) setMarking(false); }, [placing]);

  /**
   * Marking a cell. Clicking a marked cell unmarks it; clicking a new one when
   * the round is already full moves the oldest, which is what people expect
   * from a fixed number of markers and saves a clear-then-place.
   */
  const markDouble = useCallback((c, r) => {
    setDoubles((prev) => ({
      ...prev,
      [round]: toggleDouble(prev[round], c, r, round === 2 ? 2 : 1),
    }));
  }, [round]);

  /* A round that is switched off is not a round you can be looking at. */
  useEffect(() => {
    if (round === 2 && !doubleOn) setRound(1);
    if (round === 'final' && !finalOn) setRound(1);
  }, [round, doubleOn, finalOn]);

  // ------------------------------------------------------------- filling

  /**
   * Write a round from a topic.
   *
   * The panel closes first and the board fills in as the answers arrive: six
   * category names land as soon as they are known, then the thirty clues under
   * them. It used to sit behind a closed panel doing nothing visible for the
   * best part of a minute, and if it failed the error rendered on the page
   * underneath the panel covering it, so a failure and a slow success looked
   * exactly the same: nothing.
   */
  const fillWithAi = async (topic) => {
    setError('');
    setFill(null);
    const target = round === 2 ? 2 : 1;
    /* Kept so a failure halfway leaves the board as the host had it. The names
       land before the clues, so a model that answers the first call and fails
       the second used to overwrite whatever the host had named their own
       categories and then stop, with no way back to them. */
    const before = rounds[target];
    setWriting({ round: target, stage: 'categories', names: [] });

    try {
      const names = await aiService.generateCategories(topic);

      /* The names go on the board the moment they exist. Six headers appearing
         is real progress rather than a spinner claiming some. */
      setRounds((all) => ({
        ...all,
        [target]: {
          ...all[target],
          categories: all[target].categories.map((category, c) => ({
            ...category, name: names[c] ?? category.name,
          })),
        },
      }));
      setWriting({ round: target, stage: 'clues', names });

      const values = target === 2 ? DOUBLE_VALUES : POINT_VALUES;
      const result = await aiService.generateQuestions(names, values, target, settings.difficulty);

      const filled = emptyBoard();
      result.categories.forEach((category, c) => {
        filled.categories[c].name = category.name ?? names[c] ?? '';
        category.questions.forEach((q, r) => {
          filled.categories[c].questions[r] = {
            ...filled.categories[c].questions[r],
            points: values[r],
            answer: q.answer ?? '',
            question: q.question ?? '',
          };
        });
      });

      setRounds((all) => ({ ...all, [target]: filled }));
      setTopics((all) => ({ ...all, [target]: topic }));
      setRerolls((all) => ({ ...all, [target]: 5 }));
    } catch (err) {
      setRounds((all) => ({ ...all, [target]: before }));
      setError(aiTrouble(err));
    } finally {
      setWriting(null);
    }
  };

  const fillFromBoard = (incoming) => {
    /* Values belong to the round, not to whatever was imported: a round-one
       board dropped into Double Jeopardy is worth double. */
    const values = round === 2 ? DOUBLE_VALUES : POINT_VALUES;
    const next = {
      ...incoming,
      categories: incoming.categories.map((category) => ({
        ...category,
        questions: category.questions.map((q, r) => ({ ...q, points: values[r] })),
      })),
    };
    setRounds((all) => ({ ...all, [round]: next }));
    if (incoming.finalJeopardy && !final) setFinal(incoming.finalJeopardy);
    setFill(null);
  };

  /**
   * Another category, and its five clues with it.
   *
   * Five per round, which is what host mode always allowed. It needs the topic
   * the board came from, so it is offered only on a board that came from one:
   * there is nothing to ask a model for about a category somebody typed.
   */
  const rerollCategory = async (index) => {
    const topic = topics[round];
    if (!topic) return;

    setError('');
    try {
      const names = rounds[round].categories.map((c) => c.name);
      const replacement = await aiService.regenerateCategory(topic, names, index);
      const values = round === 2 ? DOUBLE_VALUES : POINT_VALUES;
      const written = await aiService.generateQuestions([replacement], values, round === 2 ? 2 : 1, settings.difficulty);
      const fresh = written.categories?.[0];

      setRounds((all) => ({
        ...all,
        [round]: {
          ...all[round],
          categories: all[round].categories.map((category, c) => (
            c !== index ? category : {
              name: fresh?.name ?? replacement,
              questions: values.map((points, r) => ({
                points,
                answer: fresh?.questions?.[r]?.answer ?? '',
                question: fresh?.questions?.[r]?.question ?? '',
                options: null, mediaType: null, mediaData: null,
                youtubeStart: null, youtubeEnd: null, audioOnly: false, altText: null,
              })),
            }
          )),
        },
      }));
      setRerolls((all) => ({ ...all, [round]: Math.max(all[round] - 1, 0) }));
    } catch (err) {
      setError(aiTrouble(err));
    }
  };

  /** Three plausible wrong answers for a clue that already has a right one. */
  const suggestWrong = async ({ clue, response, category }) => {
    setError('');
    try {
      const result = await aiService.generateMCOptions(response, category, clue);
      /* generateMCOptions returns the correct answer first. The editor derives
         index zero from the response itself, so only the wrong ones matter and
         handing back all four would put the answer in twice. */
      return (result?.options ?? []).slice(1);
    } catch (err) {
      setError(aiTrouble(err));
      return [];
    }
  };

  // ------------------------------------------------------------- starting

  /* Both extra rounds are on by default, so a host who wants one board is
     asked for sixty-one clues. That is the honest cost of writing them rather
     than having a model invent one mid-game, and the way out has to be as
     visible as the requirement. */
  const notReady = (() => {
    if (written[1] < 30) return `Round one has ${30 - written[1]} clues left`;
    if (doubleOn && written[2] < 30) {
      return `Double Jeopardy has ${30 - written[2]} clues left, or turn it off in Game Settings`;
    }
    if (finalOn && finalIs !== 'complete') {
      return finalIs === 'partial'
        ? 'Final Jeopardy is half written. Finish it or clear it.'
        : 'Final Jeopardy is not written, or turn it off in Game Settings';
    }
    if (!isConnected) return 'Connecting';
    return null;
  })();

  /**
   * Make the room, then hand it the board.
   *
   * Everything happens here rather than on arrival: the code belongs to a game
   * that exists, the settings the room is created with are the ones the host
   * finished choosing, and a host who changes their mind and leaves has not
   * left a room behind.
   */
  /* Defaults, then whatever is already there, then the field being typed in.
     Written three times inline it repeated the key it was overriding, which
     works because the last one wins but reads like a mistake. */
  const editFinal = (field) => (e) => setFinal((f) => ({
    category: '', answer: '', question: '', ...(f ?? {}), [field]: e.target.value,
  }));

  const start = async () => {
    if (notReady || opening) return;
    setOpening(true);
    setError('');

    try {
      const rules = { answerMode, projectorMode, ...roomRulesFromSettings(settings) };
      const { roomCode: code } = await socketClient.createRoom('host', { maxPlayers: 30, ...rules });

      const room = useRoomStore.getState();
      room.setRoomCode(code);
      room.setIsHost(true);
      room.setRoomType('host');
      /* Written locally as well as sent, because the game screen reads these
         from the store and mounts after the room already has them. */
      room.updateSettings(rules);

      const joined = await socketClient.joinRoom(code, 'Host', null);
      if (joined?.players) room.setPlayers(joined.players);

      const one = boardToHost(rounds[1]);
      const two = boardToHost(rounds[2]);
      setCategories(one.categories);
      setQuestions(one.questions);

      socketClient.emit('host:set-custom-questions', {
        roomCode: code,
        categories: one.categories,
        questions: one.questions,
        dailyDoubles: placing ? doubles[1] : null,
      });

      sessionStorage.setItem('jeopardy_fresh_join', 'true');
      navigate(`/game/${code}`, {
        state: {
          hostModeQuestions: {
            categories: one.categories,
            questions: one.questions,
            answerMode,
            projectorMode,
            dailyDoubles: placing ? doubles[1] : null,
            /* Carried so the game never has to invent a second round or reach
               for one of five hardcoded finals. See GamePage. */
            round2: doubleOn
              ? {
                categories: two.categories,
                questions: two.questions,
                dailyDoubles: placing ? doubles[2] : null,
              }
              : null,
            finalJeopardy: finalOn ? final : null,
          },
        },
      });
    } catch (err) {
      setError(err.message || 'Could not open a room. Check your connection.');
      setOpening(false);
    }
  };

  // ------------------------------------------------------------- render

  const tabs = [
    { key: 1, name: 'Round one', note: `${written[1]} of 30` },
    doubleOn && { key: 2, name: 'Double Jeopardy', note: `${written[2]} of 30` },
    finalOn && {
      key: 'final',
      name: 'Final',
      note: finalIs === 'complete' ? 'Written' : finalIs === 'partial' ? 'Half written' : 'Not written',
    },
  ].filter(Boolean);

  return (
    <div className="host-page">
      <header className="host-top">
        <button className="plain-btn host-back" onClick={() => navigate('/menu')}>
          &lsaquo; Menu
        </button>
        <span className="host-title">Host a game</span>
        <div className="host-right">
          <button
            className="plain-btn quiet-action host-settings"
            onClick={() => setShowSettings(true)}
          >
            <Icon name="settings" size={15} />
            Game Settings
          </button>
        </div>
      </header>

      <main className="host-body">
        {tabs.length > 1 && (
          <nav className="host-rounds" aria-label="Rounds">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={`plain-btn host-round ${round === tab.key ? 'is-on' : ''}`}
                aria-current={round === tab.key ? 'page' : undefined}
                onClick={() => setRound(tab.key)}
              >
                <span className="host-round-name">{tab.name}</span>
                <span className="host-round-note">{tab.note}</span>
              </button>
            ))}
          </nav>
        )}

        {error && <p className="host-error">{error}</p>}

        {round === 'final' ? (
          <div className="host-final">
            <p className="host-write">One clue, and everybody wagers before they see it</p>
            <label className="host-field" data-field="category">
              <span>Category</span>
              <input
                value={final?.category ?? ''}
                maxLength={60}
                placeholder="One more category"
                onChange={editFinal('category')}
              />
            </label>
            <label className="host-field" data-field="clue">
              <span>The clue</span>
              <textarea
                value={final?.answer ?? ''}
                maxLength={1000}
                placeholder="What the players see after the wagers"
                onChange={editFinal('answer')}
              />
            </label>
            <label className="host-field" data-field="response">
              <span>Correct response</span>
              <input
                value={final?.question ?? ''}
                maxLength={1000}
                placeholder="What is&hellip;?"
                onChange={editFinal('question')}
              />
            </label>
            {finalIs !== 'none' && (
              <button className="plain-btn quiet-action host-clear-final" onClick={() => setFinal(null)}>
                Clear Final Jeopardy
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="host-write-line">
              <span className="host-write">Pick any cell and write it</span>
              <button
                className="plain-btn quiet-action host-ai"
                onClick={() => setFill('ai')}
                disabled={Boolean(writing)}
              >
                {/* The four-pointed star the menu cards already use, rather than
                    a sparkle borrowed from every other AI feature online. */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 0 L14.4 9.6 L24 12 L14.4 14.4 L12 24 L9.6 14.4 L0 12 L9.6 9.6 Z" />
                </svg>
                {atWork
                  ? (writing.stage === 'categories' ? 'Thinking of six categories' : 'Writing the clues')
                  : 'Or use AI to create the board'}
              </button>

              {placing && (
                <button
                  className={`plain-btn quiet-action host-ai ${marking ? 'is-on' : ''}`}
                  aria-pressed={marking}
                  onClick={() => setMarking((on) => !on)}
                >
                  {marking
                    ? 'Done placing'
                    : `Place the Daily ${wanted === 1 ? 'Double' : 'Doubles'}`}
                </button>
              )}
            </div>

            {atWork && (
              <p className="host-writing" role="status">
                <span className="host-writing-dot" aria-hidden="true" />
                {writing.stage === 'categories'
                  ? 'Thinking of six categories'
                  : `Writing thirty clues for ${writing.names.slice(0, 3).join(', ')}${
                    writing.names.length > 3 ? ' and three more' : ''}`}
              </p>
            )}

            <div className={atWork ? 'host-board is-writing' : 'host-board'}>
            <BoardGridEditor
              board={board}
              onChange={onBoardChange}
              /* Only on a board that came from a topic: there is nothing to ask
                 a model for about a category somebody typed themselves. */
              onReroll={topics[round] ? rerollCategory : undefined}
              rerollsLeft={rerolls[round]}
              onSuggestWrong={suggestWrong}
              /* Host mode has a Final tab of its own. The editor's own Final
                 Jeopardy tile wrote into the round's board, which this screen
                 never reads, so a Final written there looked saved on the tile
                 and was thrown away at the start of the game. */
              showFinal={false}
              dailyDoubles={placed}
              dailyDoublesWanted={wanted}
              onToggleDailyDouble={marking ? markDouble : undefined}
            />
            </div>
          </>
        )}

        <div className="host-foot">
          {/* Both of these fill a board, and Final Jeopardy is one clue rather
              than a board, so on that tab they would do nothing you could see. */}
          <div className="host-foot-alts">
            {round !== 'final' && (
              <>
                <button className="plain-btn quiet-action host-alt" onClick={() => setFill('file')}>
                  <Icon name="upload" size={14} />
                  Upload a file
                </button>
                <button className="plain-btn quiet-action host-alt" onClick={() => setFill('board')}>
                  <Icon name="copy" size={14} />
                  Duplicate a community board
                </button>
              </>
            )}
          </div>

          {/* Create, not start. This hands the board to the room and opens the
              lobby, where the host waits for people and then starts for real. */}
          <button
            className="btn-primary host-start"
            onClick={start}
            disabled={Boolean(notReady) || opening}
          >
            {opening ? 'Opening the room' : 'Create game'}
          </button>
        </div>

        {notReady && <p className="host-notready">{notReady}</p>}
      </main>

      {showSettings && <HostSettingsSheet onClose={() => setShowSettings(false)} />}

      {fill && (
        <HostFillPanel
          kind={fill}
          round={round === 2 ? 2 : 1}
          token={token}
          onTopic={fillWithAi}
          onBoard={fillFromBoard}
          onClose={() => setFill(null)}
        />
      )}
    </div>
  );
}
