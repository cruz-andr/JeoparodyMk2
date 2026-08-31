import { useEffect, useRef } from 'react';
import { useHostStore } from '../../stores/hostStore';
import { useSettingsStore } from '../../stores/settingsStore';
import './HostSettingsSheet.css';

/**
 * Game Settings, in plain English.
 *
 * This used to be step one of six, which asked somebody to choose a timer
 * before they had said what the game was about. It is a layer over the board
 * now, openable at any moment including after people have joined.
 *
 * The words matter as much as the placement. "Buzzer" does not tell a teacher
 * that players shout the answer and they decide; "30s" is not a sentence. Every
 * option here says what will happen to the people in the room.
 */
const ANSWER_MODES = [
  { value: 'verbal', name: 'They buzz in and say it out loud', note: 'You decide who is right' },
  { value: 'typed', name: 'They type their answer', note: 'You decide who is right' },
  { value: 'multiple_choice', name: 'They pick from four options', note: 'Marked automatically. Needs three wrong answers on every clue' },
  { value: 'auto_grade', name: 'They type, and it is marked for them', note: 'Close spellings accepted' },
];

const TIMES = [
  { value: null, label: 'No limit' },
  { value: 15000, label: '15s' },
  { value: 30000, label: '30s' },
  { value: 45000, label: '45s' },
  { value: 60000, label: '60s' },
];

export default function HostSettingsSheet({ onClose }) {
  const { answerMode, setAnswerMode, projectorMode, setProjectorMode } = useHostStore();
  const {
    questionTimeLimit, setQuestionTimeLimit,
    enableDoubleJeopardy, toggleDoubleJeopardy,
    enableDailyDouble, toggleDailyDouble,
    dailyDoublePlacement, setDailyDoublePlacement,
    enableFinalJeopardy, toggleFinalJeopardy,
  } = useSettingsStore();

  const panel = useRef(null);

  /* Escape closes it, and focus starts inside so a keyboard is not left behind
     the sheet on the board it cannot see. */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="hs-scrim" onClick={onClose}>
      <div
        className="hs-sheet"
        role="dialog"
        aria-label="Game Settings"
        tabIndex={-1}
        ref={panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="hs-top">
          <span className="hs-title">Game Settings</span>
          <button className="plain-btn quiet-action hs-done" onClick={onClose}>Done</button>
        </header>

        <div className="hs-body">
          <section>
            <h3>How do players answer?</h3>
            {ANSWER_MODES.map((mode) => (
              <button
                key={mode.value}
                className={`plain-btn hs-pick ${answerMode === mode.value ? 'is-on' : ''}`}
                aria-pressed={answerMode === mode.value}
                onClick={() => setAnswerMode(mode.value)}
              >
                <span className="hs-pick-name">{mode.name}</span>
                <span className="hs-pick-note">{mode.note}</span>
              </button>
            ))}

            <h3 className="hs-later">How long to answer?</h3>
            <div className="hs-seg">
              {TIMES.map((time) => (
                <button
                  key={time.label}
                  className={`plain-btn hs-seg-btn ${questionTimeLimit === time.value ? 'is-on' : ''}`}
                  aria-pressed={questionTimeLimit === time.value}
                  onClick={() => setQuestionTimeLimit(time.value)}
                >
                  {time.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3>The game</h3>

            <label className="hs-toggle">
              <span>
                Double Jeopardy
                <small>A second board at double the money. You write it.</small>
              </span>
              <input type="checkbox" checked={enableDoubleJeopardy} onChange={toggleDoubleJeopardy} />
              <span className="hs-switch" aria-hidden="true" />
            </label>

            <label className="hs-toggle">
              <span>
                Daily Doubles
                <small>One in round one, two in round two.</small>
              </span>
              <input type="checkbox" checked={enableDailyDouble} onChange={toggleDailyDouble} />
              <span className="hs-switch" aria-hidden="true" />
            </label>

            {/* Only worth asking once they are on. A quiz night host wants the
                Daily Double on the last clue of the hardest category; a
                classroom mostly does not care. */}
            {enableDailyDouble && (
              <div className="hs-seg hs-under">
                {[
                  { value: 'random', label: 'Placed at random' },
                  { value: 'chosen', label: 'I will place them' },
                ].map((option) => (
                  <button
                    key={option.value}
                    className={`plain-btn hs-seg-btn ${dailyDoublePlacement === option.value ? 'is-on' : ''}`}
                    aria-pressed={dailyDoublePlacement === option.value}
                    onClick={() => setDailyDoublePlacement(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}

            <label className="hs-toggle">
              <span>
                Final Jeopardy
                <small>One clue everybody wagers on. You write it.</small>
              </span>
              <input type="checkbox" checked={enableFinalJeopardy} onChange={toggleFinalJeopardy} />
              <span className="hs-switch" aria-hidden="true" />
            </label>

            <h3 className="hs-later">The room</h3>
            <label className="hs-toggle is-last">
              <span>
                Projector mode
                <small>
                  Everyone is in the room with you, so their phones become
                  buzzers and the board goes on the screen behind you.
                </small>
              </span>
              <input type="checkbox" checked={projectorMode} onChange={() => setProjectorMode(!projectorMode)} />
              <span className="hs-switch" aria-hidden="true" />
            </label>
          </section>
        </div>
      </div>
    </div>
  );
}
