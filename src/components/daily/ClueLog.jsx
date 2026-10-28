import { useState } from 'react';
import { answerMark, sixerEarned } from '../../stores/dailyLogic';

/* The six clues as a list, easy to hard, in the manner of the daily games
   people share: the category over each, the response with how it went, what
   it paid, and how many of the day's players got it. Tapping a clue opens it,
   with what the player typed. */

/* A clue got with the hint wears a dash like a pass, told apart by its
   colour: yellow for half, grey for nothing. */
const SIGN = { correct: '✓', hinted: '–', wrong: '✗', passed: '–', unplayed: '' };
const SAID = { correct: 'Right', hinted: 'Right with the hint', wrong: 'Missed', passed: 'Passed', unplayed: '' };

export default function ClueLog({ questions, answers, stats, theirAnswers = null }) {
  const [open, setOpen] = useState(null);

  return (
    <div className="clue-log">
      <div className="clue-log-head">
        <span>What is&hellip; your recap?</span>
      </div>
      <ol className="clue-log-lines">
        {questions.map((q, i) => {
          const mark = answerMark(answers[i]);
          const value = Number(q.value) || 0;
          const paid = sixerEarned(answers[i], value);
          const clue = stats?.clues?.[i];
          const got = clue
            ? Math.round((clue.share ?? (stats.players ? (clue.right + clue.hinted) / stats.players : 0)) * 100)
            : null;
          const isOpen = open === i;
          return (
            <li key={i} className={`clue-line ${mark}`}>
              <button
                type="button"
                className="clue-line-main"
                aria-expanded={isOpen}
                aria-label={`Clue ${i + 1}, ${q.category}, worth $${value}: ${SAID[mark]}, won $${paid}`}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span className="clue-line-category">{q.category} &middot; ${value.toLocaleString()}</span>
                <span className="clue-line-n">{i + 1}</span>
                <span className="clue-line-sign" aria-hidden="true">{SIGN[mark]}</span>
                <span className="clue-line-answer">{q.answer}</span>
                <span className="clue-line-paid">{paid ? `+$${paid.toLocaleString()}` : '$0'}</span>
                {got !== null && (
                  <span className="clue-line-share"><b>{got}%</b> of players got this</span>
                )}
              </button>
              {isOpen && (
                <div className="clue-line-detail">
                  {/* The clue as a quotation, in the board's clue face. */}
                  <blockquote className="clue-line-clue">{q.clue}</blockquote>
                  <p className="clue-line-said">
                    <span className="clue-line-said-label">{mark === 'passed' ? 'Passed' : 'You said'}</span>
                    {mark !== 'passed' && <b>{answers[i]?.playerAnswer || 'nothing'}</b>}
                    {mark === 'hinted' && <span className="clue-line-said-note">after the hint</span>}
                  </p>
                  {/* From the link a friend shared: what they typed. */}
                  {Array.isArray(theirAnswers) && i < theirAnswers.length && (
                    <p className="clue-line-said">
                      <span className="clue-line-said-label">They said</span>
                      {theirAnswers[i] ? <b>{theirAnswers[i]}</b> : <span className="clue-line-said-note">nothing (passed)</span>}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
