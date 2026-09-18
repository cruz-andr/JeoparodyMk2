import { Plate, Roster, Btn, Ghost, Seg, Toggle, Rule, CodeCells, Clock } from '../studio/Studio';
import { QUESTION_TIME_LIMITS } from '../../stores/settingsStore';

/**
 * The room before the game: the code, and who is in it.
 *
 * One component for both kinds of room, because they are the same waiting
 * screen with different reasons to wait. A private room waits on people the
 * host invited, so it shows the code they need and the button the host
 * presses. A quickplay game was filled by the matchmaker and has no host at
 * all, so it shows the players who arrived and gets on with dealing.
 *
 * Nothing here is a list of names with a badge beside it. Everybody at the
 * game is a name panel, the way they will be for the rest of the game.
 */
export default function Lobby({
  roomType,
  roomCode,
  players,
  youId,
  isHost,
  isReady,
  settings,
  canEditSettings,
  onSettingsChange,
  onStart,
  onToggleReady,
  onKick,
  onLeave,
  startLabel,
  canStart,
  waitingFor,
  isHostMode = false,
}) {
  const quickplay = roomType === 'quickplay';
  const seats = quickplay ? 3 : Math.max(players.length, 2);

  const rows = Array.from({ length: Math.max(seats, players.length) }, (_, i) => {
    const player = players[i];
    if (!player) {
      return { key: `open-${i}`, player: null, waiting: true, label: 'Waiting', status: 'Empty' };
    }
    const you = player.id === youId;
    let status = you ? 'You' : 'Here';
    if (player.isHost) status = 'Host';
    else if (!quickplay && !isHostMode) status = player.isReady ? 'Ready' : 'Not ready';
    if (!player.isConnected) status = 'Away';
    return { key: player.id, player, isYou: you, status };
  });

  return (
    <div className="lobby">
      {quickplay ? (
        <div className="lobby-quickplay">
          <Clock seconds={0} label="Dealing" />
          <p className="lobby-headline">The board is being dealt</p>
          <p className="st-note is-centred">Real clues from a real episode. This takes a moment.</p>
        </div>
      ) : (
        <div className="st-two lobby-room">
          <div className="st-stack">
            <div className="st-field">
              <span className="st-field-label">Your room code</span>
              <CodeCells code={roomCode || ''} />
              <span className="st-hint">Read it out, or send the link. No O, 0, I or 1.</span>
            </div>
            {canEditSettings ? (
              <div className="st-rules">
                <Rule name="Clue clock" what="How long everyone gets to ring in">
                  <Seg
                    ariaLabel="Clue clock"
                    value={settings?.questionTimeLimit ?? 30000}
                    onChange={(v) => onSettingsChange({ questionTimeLimit: v })}
                    options={QUESTION_TIME_LIMITS.map((o) => ({ value: o.value, label: o.value ? `${o.value / 1000}s` : 'Off' }))}
                  />
                </Rule>
                <Rule name="Double Jeopardy" what="A second board at twice the money">
                  <Toggle
                    ariaLabel="Double Jeopardy"
                    on={Boolean(settings?.enableDoubleJeopardy)}
                    onChange={(v) => onSettingsChange({ enableDoubleJeopardy: v })}
                  />
                </Rule>
                <Rule name="Final Jeopardy" what="Wager it all on one last clue">
                  <Toggle
                    ariaLabel="Final Jeopardy"
                    on={Boolean(settings?.enableFinalJeopardy)}
                    onChange={(v) => onSettingsChange({ enableFinalJeopardy: v })}
                  />
                </Rule>
              </div>
            ) : (
              <p className="st-note">
                The host sets the rules. {settings?.enableDoubleJeopardy ? 'Two rounds' : 'One round'}
                {settings?.enableFinalJeopardy ? ', Final Jeopardy' : ''}
                {settings?.questionTimeLimit ? `, ${settings.questionTimeLimit / 1000} second clock` : ', no clock'}.
              </p>
            )}
          </div>

          <div className="st-stack">
            <Roster rows={rows} count={`${players.length} of ${seats}`} heading="In the room" />
            {isHost && players.some((p) => p.id !== youId) && onKick && (
              <div className="lobby-kicks">
                {players.filter((p) => p.id !== youId).map((p) => (
                  <button type="button" key={p.id} className="plain-btn quiet-action" onClick={() => onKick(p.id)}>
                    Remove {p.displayName || p.name}
                  </button>
                ))}
              </div>
            )}
            {isHost ? (
              <>
                <Btn wide onClick={onStart} disabled={!canStart} className="lobby-start">{startLabel}</Btn>
                {!canStart && waitingFor && <p className="st-note is-centred">{waitingFor}</p>}
              </>
            ) : (
              <>
                <Btn wide onClick={onToggleReady} className="lobby-ready">
                  {isReady ? 'Ready' : 'I am ready'}
                </Btn>
                <p className="st-note is-centred">
                  {isReady ? 'Waiting for the host to start.' : 'Tell the host you are in.'}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      <div className="lobby-out">
        <Ghost onClick={onLeave}>{quickplay ? 'Leave the game' : 'Leave the room'}</Ghost>
      </div>
    </div>
  );
}

export { Plate };
