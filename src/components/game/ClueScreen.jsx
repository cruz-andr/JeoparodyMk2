import MediaClueDisplay from '../media/MediaClueDisplay';
import './ClueScreen.css';

/* A clue as the show draws one. Words alone fill the screen; a picture, a
   clip or a sound sits beside them inside the same blue, the way the show's
   board puts a video clue on one side and its text on the other, rather than
   stacked above the clue like an attachment. On a phone the two stack. */
export default function ClueScreen({
  clue, text, hostControls = false, roomCode = null, onMediaDone = null,
  // Final Jeopardy sets its clue in its own face.
  textClassName = 'clue-text',
}) {
  const media = Boolean(clue?.mediaType && clue?.mediaData);
  return (
    <div className={`clue-screen${media ? ' has-media' : ''}`}>
      {media && (
        <div className="clue-screen-media">
          <MediaClueDisplay question={clue} fill hostControls={hostControls} roomCode={roomCode} onMediaDone={onMediaDone} />
        </div>
      )}
      <p className={textClassName}>{text}</p>
    </div>
  );
}
