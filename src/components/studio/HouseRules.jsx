import { useState } from 'react';
import { Rule, Seg, Toggle } from './Studio';
import { useSettingsStore, QUESTION_TIME_LIMITS } from '../../stores/settingsStore';
import { rulesSentence } from './rulesSentence';

/**
 * The rules, as one line with a way in.
 *
 * A screen that puts six switches in front of somebody who wants to play a
 * quiz is a settings screen with a game attached. The line says what the game
 * will be; the switches are one press away for the few people who want them.
 * These are the player's own settings, the ones the Settings page edits, so a
 * game started here plays by what the line says.
 */
export default function HouseRules({ showDifficulty = false, alwaysOpen = false }) {
  const [open, setOpen] = useState(false);
  const s = useSettingsStore();
  const set = s.updateSetting;

  /* On a phone the rules are one line with a way in, because six switches in
     front of somebody who wants to play a quiz is a settings screen with a
     game attached. On a desk there is room for them, so they are simply
     there: nothing to press to find out what the game will be. */
  if (!open && !alwaysOpen) {
    return (
      <p className="st-rules-line">
        <span>{rulesSentence(s)}</span>
        <button type="button" className="st-rules-open" onClick={() => setOpen(true)}>Change</button>
      </p>
    );
  }

  return (
    <div className="st-stack">
      {alwaysOpen && <span className="st-field-label">House rules</span>}
      <div className="st-rules">
        <Rule name="Clue clock" what="How long you get to ring in">
          <Seg
            ariaLabel="Clue clock"
            value={s.questionTimeLimit}
            onChange={(v) => set('questionTimeLimit', v)}
            options={QUESTION_TIME_LIMITS.map((o) => ({
              value: o.value,
              label: o.value ? `${o.value / 1000}s` : 'Off',
            }))}
          />
        </Rule>
        <Rule name="Double Jeopardy" what="A second board at twice the money">
          <Toggle ariaLabel="Double Jeopardy" on={s.enableDoubleJeopardy} onChange={(v) => set('enableDoubleJeopardy', v)} />
        </Rule>
        <Rule name="Daily Doubles" what="One hidden wager in round one, two in round two">
          <Toggle ariaLabel="Daily Doubles" on={s.enableDailyDouble} onChange={(v) => set('enableDailyDouble', v)} />
        </Rule>
        <Rule name="Final Jeopardy" what="Wager it all on one last clue">
          <Toggle ariaLabel="Final Jeopardy" on={s.enableFinalJeopardy} onChange={(v) => set('enableFinalJeopardy', v)} />
        </Rule>
        {showDifficulty && (
          <Rule name="Clues" what="How hard the board should be">
            <Seg
              ariaLabel="Difficulty"
              value={s.difficulty}
              onChange={(v) => set('difficulty', v)}
              options={[
                { value: 'easy', label: 'Easy' },
                { value: 'mixed', label: 'Mixed' },
                { value: 'hard', label: 'Hard' },
              ]}
            />
          </Rule>
        )}
      </div>
      {!alwaysOpen && (
        <p className="st-rules-line">
          <button type="button" className="st-rules-open" onClick={() => setOpen(false)}>Done</button>
        </p>
      )}
    </div>
  );
}
