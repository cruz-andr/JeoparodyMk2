import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { socketClient } from '../../services/socket/socketClient';
import './HostControlPanel.css';

// Reusable component for player names with hover tooltip showing their drawing
function PlayerNameWithDrawing({ player, className = '' }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const displayName = player?.displayName || player?.name || player?.playerName || 'Unknown';

  return (
    <span
      className={`player-name-with-drawing ${className}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {displayName}
      {showTooltip && player?.signature && (
        <div className="player-drawing-tooltip">
          <img src={player.signature} alt={`${displayName}'s drawing`} />
        </div>
      )}
    </span>
  );
}

export default function HostControlPanel({
  roomCode,
  currentQuestion,
  buzzedPlayer,
  typedAnswers = [],
  players = [],
  answerMode = 'verbal',
  buzzerOpen = false,
  onClose,
}) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [scoreAdjustment, setScoreAdjustment] = useState(0);

  const points = currentQuestion?.points || 0;

  const handleJudge = (playerId, correct) => {
    socketClient.emit('host:judge-answer', {
      roomCode,
      playerId,
      correct,
      points,
    });
  };

  const handleSkipQuestion = () => {
    socketClient.emit('host:skip-question', { roomCode });
  };

  const handleRevealAnswers = () => {
    socketClient.emit('host:reveal-answers', { roomCode });
  };

  const handleOpenBuzzer = () => {
    socketClient.emit('host:open-buzzer', { roomCode });
  };

  const handleCloseBuzzer = () => {
    socketClient.emit('host:close-buzzer', { roomCode });
  };

  const handleScoreOverride = (playerId) => {
    const player = players.find(p => p.id === playerId);
    if (player && scoreAdjustment !== 0) {
      const newScore = (player.score || 0) + scoreAdjustment;
      socketClient.emit('host:override-score', {
        roomCode,
        playerId,
        newScore,
        reason: 'Manual adjustment',
      });
      setScoreAdjustment(0);
      setSelectedPlayerId(null);
    }
  };

  const handleKickPlayer = (playerId) => {
    if (confirm('Are you sure you want to remove this player?')) {
      socketClient.emit('host:kick-player', { roomCode, playerId });
    }
  };

  const formatScore = (score) => {
    const absScore = Math.abs(score || 0);
    return score < 0 ? `-$${absScore.toLocaleString()}` : `$${absScore.toLocaleString()}`;
  };

  return (
    <AnimatePresence mode="wait">
      {isMinimized ? (
        <motion.div
          key="minimized"
          className="host-control-panel minimized"
          onClick={() => setIsMinimized(false)}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.15 }}
        >
          <span className="expand-hint">Host Controls</span>
        </motion.div>
      ) : (
        <motion.div
          key="expanded"
          className="host-control-panel"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.15 }}
          drag
          dragMomentum={false}
        >
      <div className="panel-header">
        <h3>Host Controls</h3>
        <div className="panel-actions">
          <button onClick={() => setIsMinimized(true)} className="minimize-btn">
            _
          </button>
        </div>
      </div>

      {/* Current Question Info */}
      {currentQuestion && (
        <div className="current-question-section">
          <div className="question-info">
            <span className="category-label">{currentQuestion.category}</span>
            <span className="points-label">${points}</span>
          </div>
          <div className="question-content">
            <p className="clue-text">{currentQuestion.answer}</p>
            <p className="answer-text">
              <strong>Answer:</strong> {currentQuestion.question}
            </p>
          </div>
        </div>
      )}

      {/* Buzzer Status (Verbal Mode) */}
      {answerMode === 'verbal' && currentQuestion && (
        <div className="buzzer-section">
          {buzzedPlayer ? (
            <div className="buzzed-player">
              <span className="buzzed-label">Buzzed:</span>
              <PlayerNameWithDrawing player={buzzedPlayer} className="buzzed-name" />
              <span className="reaction-time">
                {buzzedPlayer.reactionTime}ms
              </span>
            </div>
          ) : (
            <div className="buzzer-controls">
              <button
                onClick={handleOpenBuzzer}
                className={`btn-open-buzzer ${buzzerOpen ? 'active' : ''}`}
                disabled={buzzerOpen}
              >
                {buzzerOpen ? 'Buzzer Open' : 'Open Buzzer'}
              </button>
              <button
                onClick={handleCloseBuzzer}
                className="btn-close-buzzer"
                disabled={!buzzerOpen}
              >
                Close Buzzer
              </button>
            </div>
          )}
        </div>
      )}

      {/* Judging Buttons */}
      {buzzedPlayer && answerMode === 'verbal' && (
        <div className="judging-section">
          <h4>Judge Answer</h4>
          <div className="judge-buttons">
            <button
              className="btn-correct"
              onClick={() => handleJudge(buzzedPlayer.id, true)}
            >
              Correct (+${points})
            </button>
            <button
              className="btn-incorrect"
              onClick={() => handleJudge(buzzedPlayer.id, false)}
            >
              Incorrect (-${points})
            </button>
          </div>
        </div>
      )}

      {/* Typed Answers (Typed/Auto-Grade Mode) */}
      {(answerMode === 'typed' || answerMode === 'auto_grade') && typedAnswers.length > 0 && (
        <div className="typed-answers-section">
          <h4>Player Answers ({typedAnswers.length})</h4>
          <div className="answers-list">
            {typedAnswers.map((entry) => {
              // Find the full player object to get signature
              const player = players.find(p => p.id === entry.playerId) || { displayName: entry.playerName };
              return (
              <div key={entry.playerId} className="answer-entry">
                <div className="answer-header">
                  <PlayerNameWithDrawing player={player} className="player-name" />
                  {entry.autoGradeResult && (
                    <span className={`auto-grade ${entry.autoGradeResult.isCorrect ? 'correct' : 'incorrect'}`}>
                      {entry.autoGradeResult.isCorrect ? 'Correct' : 'Incorrect'}
                      ({Math.round(entry.autoGradeResult.confidence * 100)}%)
                    </span>
                  )}
                </div>
                <p className="player-answer">{entry.answer}</p>
                <div className="answer-actions">
                  <button
                    className="btn-sm btn-correct"
                    onClick={() => handleJudge(entry.playerId, true)}
                  >
                    Correct
                  </button>
                  <button
                    className="btn-sm btn-incorrect"
                    onClick={() => handleJudge(entry.playerId, false)}
                  >
                    Incorrect
                  </button>
                </div>
              </div>
            );
            })}
          </div>
          <button onClick={handleRevealAnswers} className="btn-reveal">
            Reveal All Answers
          </button>
        </div>
      )}

      {/* Score Management */}
      <div className="scores-section">
        <h4>Player Scores</h4>
        <div className="scores-list">
          {players.filter(p => !p.isHost).map((player) => (
            <div key={player.id} className="score-entry">
              <PlayerNameWithDrawing player={player} className="player-name" />
              <span className={`player-score ${player.score < 0 ? 'negative' : ''}`}>
                {formatScore(player.score)}
              </span>
              <div className="score-actions">
                {selectedPlayerId === player.id ? (
                  <>
                    <input
                      type="number"
                      value={scoreAdjustment}
                      onChange={(e) => setScoreAdjustment(parseInt(e.target.value) || 0)}
                      placeholder="+/-"
                      className="score-input"
                    />
                    <button
                      onClick={() => handleScoreOverride(player.id)}
                      className="btn-apply"
                    >
                      Apply
                    </button>
                    <button
                      onClick={() => setSelectedPlayerId(null)}
                      className="btn-cancel"
                    >
                      X
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setSelectedPlayerId(player.id)}
                      className="btn-adjust"
                    >
                      Adjust
                    </button>
                    <button
                      onClick={() => handleKickPlayer(player.id)}
                      className="btn-kick"
                    >
                      Kick
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

        {/* Game Controls */}
        <div className="game-controls">
          {currentQuestion && (
            <button onClick={handleSkipQuestion} className="btn-skip">
              Skip Question
            </button>
          )}
        </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
