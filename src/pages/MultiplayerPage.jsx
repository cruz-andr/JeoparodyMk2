import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../hooks';
import { useRoomStore, useUserStore, useSettingsStore } from '../stores';
import { roomRulesFromSettings } from '../stores/settingsStore';
import { socketClient } from '../services/socket/socketClient';
import Studio, { Live, Btn, Tabs, CodeCells } from '../components/studio/Studio';
import HouseRules from '../components/studio/HouseRules';
import SignatureCanvas from '../components/common/SignatureCanvas';
import { usePageTitle } from '../hooks/usePageTitle';
import { useMediaQuery } from '../hooks/useMediaQuery';
import '../components/common/SignatureCanvas.css';
import './MultiplayerPage.css';

/* The pad is a fixed pixel canvas, so its size is a prop rather than CSS.
   A name drawn with a mouse wants room; a thumb on a phone does not have it. */
const DESK_PAD = { width: 460, height: 150 };
const PHONE_PAD = { width: 300, height: 80 };

// Room codes are six characters from an unambiguous alphabet (no O/0, I/1).
const CODE_LENGTH = 6;
const CODE_ALPHABET = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

export default function MultiplayerPage() {
  usePageTitle('Multiplayer');
  const navigate = useNavigate();
  const onDesk = useMediaQuery('(min-width: 821px)');
  const [side, setSide] = useState('open'); // 'open' | 'join'
  const [opening, setOpening] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [signature, setSignature] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState(null);
  const [code, setCode] = useState('');
  const codeInputRef = useRef(null);

  const { isConnected, isConnecting, error: socketError, joinRoom } = useSocket();
  const { resetRoom } = useRoomStore();
  const { user, isGuest } = useUserStore();

  /* The name that goes on the card: the one just drawn, else the one saved on
     the account. Whether the pad is shown is a separate question, and it turns
     on the SAVED name only. Asking it about `myName` hid the pad the instant
     the first stroke landed, because a stroke is a signature. */
  const savedName = user?.signature || null;
  const myName = signature || savedName;
  const showPad = !savedName || drawing;

  useEffect(() => {
    if (user?.displayName) setDisplayName(user.displayName);
    else if (isGuest) setDisplayName(`Player${Math.floor(Math.random() * 1000)}`);
  }, [user, isGuest]);

  const handleOpenRoom = async () => {
    if (!myName) {
      setError('Draw your name first.');
      return;
    }

    // Generate a display name for fallback/logging
    const name = displayName.trim() || `Player${Math.floor(Math.random() * 1000)}`;

    setOpening(true);
    setError(null);

    try {
      /* Send the room's rule settings up front. Creating with none left the
         server reading enableDailyDouble as undefined, so a private game never
         got a Daily Double while the lobby still showed it as enabled.
         The rules come from the player's own settings, which are the line
         under the pad on this screen. */
      const { roomCode: newRoomCode } = await socketClient.createRoom(
        'multiplayer',
        roomRulesFromSettings(useSettingsStore.getState(), useRoomStore.getState().settings)
      );

      useRoomStore.getState().setRoomCode(newRoomCode);
      useRoomStore.getState().setIsHost(true);

      const result = await joinRoom(newRoomCode, name, myName);

      if (result.players) useRoomStore.getState().setPlayers(result.players);
      if (result.settings) useRoomStore.getState().updateSettings(result.settings);

      // Mark as fresh join to prevent reconnection race condition
      sessionStorage.setItem('jeopardy_fresh_join', 'true');

      navigate(`/game/${newRoomCode}`);
    } catch (err) {
      setError(err.message || 'Could not open the room.');
      setOpening(false);
      resetRoom();
    }
  };

  const handleCodeChange = useCallback((e) => {
    setCode(e.target.value.toUpperCase().replace(CODE_ALPHABET, '').slice(0, CODE_LENGTH));
  }, []);

  const handleJoin = useCallback((e) => {
    e.preventDefault();
    if (code.length === CODE_LENGTH) navigate(`/join/${code}`);
  }, [code, navigate]);

  const problem = error || socketError;
  const left = CODE_LENGTH - code.length;

  return (
    <Studio title="Multiplayer" className="multiplayer-page" right={<Live isConnected={isConnected} isConnecting={isConnecting} />}>
      <Tabs
        ariaLabel="Open or join"
        value={side}
        onChange={setSide}
        options={[
          { value: 'open', label: 'Open a room', note: 'You host, up to six play' },
          { value: 'join', label: 'Join with a code', note: 'Six letters from the host' },
        ]}
      />

      {side === 'open' ? (
        <div className="st-two mp-open">
          <div className="st-stack">
            <div className="st-field">
              <span className="st-field-label is-big">Draw your name</span>
              <span className="st-hint">It is what the room sees when you ring in.</span>
            </div>
            {showPad ? (
              <div className="mp-pad">
                <SignatureCanvas onSignatureChange={setSignature} {...(onDesk ? DESK_PAD : PHONE_PAD)} />
              </div>
            ) : (
              <div className="st-saved-name">
                {/* The name itself, not a sentence about it. Someone with an
                    account has already drawn this; telling them "your name is
                    on your card" asks them to take on trust the one thing that
                    is right here and was the whole point of drawing it. */}
                {/* The same box the pad would be, from the same constant, so
                    the name does not shrink into a chip the moment it is saved
                    and the two states do not shift the page between them. */}
                <div className="st-plate is-you" style={onDesk ? DESK_PAD : PHONE_PAD}>
                  <img src={savedName} alt="The name you drew" />
                </div>
                <button type="button" className="st-rules-open" onClick={() => setDrawing(true)}>Draw a new one</button>
              </div>
            )}
            {problem && <p className="st-error">{problem}</p>}
          </div>

          <div className="st-stack">
            <p className="st-note">
              You open the room, read the code to the others, and pick the topic once
              everyone is in. Up to six can play.
            </p>
            <HouseRules alwaysOpen={onDesk} />
            <Btn wide onClick={handleOpenRoom} disabled={!isConnected || !myName || opening} className="mp-open-btn">
              {opening ? 'Opening' : isConnected ? 'Open the room' : 'Connecting'}
            </Btn>
          </div>
        </div>
      ) : (
        <form className="st-two mp-join" onSubmit={handleJoin}>
          <div className="st-stack">
            <div className="st-field">
              <span className="st-field-label is-big">Got a code from the host?</span>
              <span className="st-hint">Six letters. No O, 0, I or 1, so it cannot be misheard.</span>
            </div>
            <CodeCells code={code} editable onChange={handleCodeChange} inputRef={codeInputRef} autoFocus />
          </div>
          <div className="st-stack">
            <p className="st-note">
              You draw your name on the next screen, then wait with everyone else
              until the host starts the game.
            </p>
            <Btn type="submit" wide disabled={code.length !== CODE_LENGTH} className="mp-join-btn">
              Join the game
            </Btn>
            {left > 0 && (
              <p className="st-note is-centred">
                {left === 1 ? 'One more letter' : `${left} more letters`}
              </p>
            )}
          </div>
        </form>
      )}
    </Studio>
  );
}
