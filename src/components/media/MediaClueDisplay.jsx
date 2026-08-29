import { useRef, useCallback } from 'react';
import YouTubePlayer from './YouTubePlayer';
import { socketClient } from '../../services/socket/socketClient';
import './MediaClueDisplay.css';

/**
 * Renders media (image or YouTube clip) during gameplay.
 * Used by QuestionModal, GamePage overlay, and HostControlPanel.
 */
export default function MediaClueDisplay({
  question,
  showReplayButton = true,
  hostControls = false,
  roomCode = null,
  compact = false,
}) {
  const playerRef = useRef(null);

  const handleMediaControl = useCallback((action) => {
    if (roomCode) {
      socketClient.emit('host:media-control', { roomCode, action });
    }
    // Also control local player
    if (playerRef.current) {
      playerRef.current[action]?.();
    }
  }, [roomCode]);

  if (!question?.mediaType) return null;

  // Compact mode for HostControlPanel — just show a badge/thumbnail
  if (compact) {
    if (question.mediaType === 'image') {
      return (
        <div className="media-compact">
          <img
            src={question.mediaData}
            alt={question.altText || 'Clue image'}
            className="media-compact-thumb"
          />
        </div>
      );
    }
    if (question.mediaType === 'youtube') {
      return (
        <div className="media-compact">
          <span className="media-compact-badge">
            {question.audioOnly ? 'Audio clip' : 'Video clip'}
          </span>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="media-clue-display">
      {question.mediaType === 'image' && question.mediaData && (
        <img
          src={question.mediaData}
          alt={question.altText || 'Clue image'}
          className="media-clue-image"
        />
      )}

      {question.mediaType === 'youtube' && question.mediaData && (
        <>
          <YouTubePlayer
            ref={playerRef}
            videoId={question.mediaData}
            startTime={question.youtubeStart || 0}
            endTime={question.youtubeEnd}
            autoPlay={true}
            audioOnly={question.audioOnly || false}
            interactive={hostControls}
            height={question.audioOnly ? 0 : 300}
          />

          <div className="media-controls">
            {showReplayButton && !hostControls && (
              <button
                className="media-btn"
                onClick={() => playerRef.current?.replay()}
              >
                Replay
              </button>
            )}

            {hostControls && (
              <>
                <button
                  className="media-btn"
                  onClick={() => handleMediaControl('play')}
                >
                  Play
                </button>
                <button
                  className="media-btn"
                  onClick={() => handleMediaControl('pause')}
                >
                  Pause
                </button>
                <button
                  className="media-btn"
                  onClick={() => handleMediaControl('replay')}
                >
                  Replay
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
