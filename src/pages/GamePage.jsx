import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useRoom } from '../hooks';
import { useRoomStore, useGameStore, useUserStore } from '../stores';
import { socketClient } from '../services/socket/socketClient';
import * as aiService from '../services/api/aiService';
import GenreSelector from '../components/setup/GenreSelector';
import CategoryEditor from '../components/setup/CategoryEditor';
import GameBoard from '../components/game/GameBoard';
import QuestionModal from '../components/game/QuestionModal';
import GameResults from '../components/game/GameResults';
import './GamePage.css';

export default function GamePage() {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const { leaveRoom, setReady, subscribe, isConnected } = useRoom(roomCode);
  const { players, isHost, resetRoom } = useRoomStore();
  const { setCategories, setQuestions, setPhase: setGamePhase } = useGameStore();
  const currentPlayerId = useUserStore((s) => s.oderId) || socketClient.getSocketId();

  // Game phases: 'lobby' | 'setup' | 'categoryEdit' | 'generating' | 'playing' | 'finished'
  const [phase, setPhase] = useState('lobby');
  const [isReady, setIsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Setup state (host only)
  const [genre, setGenre] = useState('');
  const [categories, setLocalCategories] = useState([]);
  const [questions, setLocalQuestions] = useState([]);

  // Game state (shared)
  const [currentPickerId, setCurrentPickerId] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [canBuzz, setCanBuzz] = useState(false);
  const [signalArrivedTime, setSignalArrivedTime] = useState(null);
  const [buzzerWinnerId, setBuzzerWinnerId] = useState(null);
  const [revealedQuestions, setRevealedQuestions] = useState(new Set());

  // Subscribe to game events
  useEffect(() => {
    if (!isConnected || !roomCode) return;

    // Host starts setup
    const unsubSetupStarted = subscribe('game:setup-started', () => {
      setPhase(isHost ? 'setup' : 'waiting');
    });

    // Categories set by host
    const unsubCategoriesSet = subscribe('game:categories-set', ({ categories }) => {
      setLocalCategories(categories);
      if (!isHost) setPhase('waiting');
    });

    // Questions ready, game starting
    const unsubQuestionsReady = subscribe('game:questions-ready', ({ questions, categories, firstPickerId }) => {
      setLocalCategories(categories);
      setLocalQuestions(questions);
      setCurrentPickerId(firstPickerId);
      setPhase('playing');
    });

    // Question selected by picker
    const unsubQuestionSelected = subscribe('game:question-selected', ({ categoryIndex, pointIndex, question }) => {
      setCurrentQuestion({ ...question, categoryIndex, pointIndex });
      setRevealedQuestions(prev => new Set([...prev, `${categoryIndex}-${pointIndex}`]));
      // Start buzz window
      setSignalArrivedTime(Date.now());
      setCanBuzz(true);
      setBuzzerWinnerId(null);
      setShowAnswer(false);
    });

    // Someone buzzed first
    const unsubBuzzerWinner = subscribe('game:buzzer-winner', ({ playerId, playerName, reactionTime }) => {
      setBuzzerWinnerId(playerId);
      setCanBuzz(false);
    });

    // Answer result
    const unsubAnswerResult = subscribe('game:answer-result', ({ playerId, correct, newScore, nextPickerId, canBuzzAgain }) => {
      // Update player score in room store
      useRoomStore.getState().updatePlayerScore(playerId, newScore);

      if (correct) {
        setCurrentPickerId(nextPickerId);
        setCurrentQuestion(null);
        setBuzzerWinnerId(null);
      } else if (canBuzzAgain) {
        // Wrong answer, others can buzz
        setBuzzerWinnerId(null);
        setSignalArrivedTime(Date.now());
        setCanBuzz(true);
      } else {
        // No one left to buzz, move on
        setCurrentPickerId(nextPickerId);
        setCurrentQuestion(null);
        setBuzzerWinnerId(null);
      }
    });

    // Game ended
    const unsubGameEnded = subscribe('game:ended', () => {
      setPhase('finished');
    });

    return () => {
      unsubSetupStarted();
      unsubCategoriesSet();
      unsubQuestionsReady();
      unsubQuestionSelected();
      unsubBuzzerWinner();
      unsubAnswerResult();
      unsubGameEnded();
    };
  }, [isConnected, roomCode, isHost, subscribe]);

  // Check if all questions revealed
  useEffect(() => {
    if (phase === 'playing' && questions.length > 0) {
      const totalQuestions = questions.length * (questions[0]?.length || 0);
      if (revealedQuestions.size >= totalQuestions) {
        socketClient.emit('game:end', { roomCode });
      }
    }
  }, [revealedQuestions, questions, phase, roomCode]);

  const handleLeave = () => {
    leaveRoom(roomCode);
    resetRoom();
    navigate('/menu');
  };

  const handleToggleReady = () => {
    const newReady = !isReady;
    setIsReady(newReady);
    setReady(roomCode, newReady);
  };

  // Host starts setup
  const handleStartSetup = () => {
    socketClient.emit('game:start-setup', { roomCode });
    setPhase('setup');
  };

  // Host generates categories
  const handleGenerateCategories = async (selectedGenre) => {
    setLoading(true);
    setError(null);

    try {
      const generatedCategories = await aiService.generateCategories(selectedGenre);
      setGenre(selectedGenre);
      setLocalCategories(generatedCategories);

      // Broadcast to all players
      socketClient.emit('game:set-categories', { roomCode, categories: generatedCategories });
      setPhase('categoryEdit');
    } catch (err) {
      console.error('Error generating categories:', err);
      setError(err.message || 'Failed to generate categories');
    } finally {
      setLoading(false);
    }
  };

  // Host edits a category
  const handleCategoryEdit = (index, newValue) => {
    const updated = [...categories];
    updated[index] = newValue;
    setLocalCategories(updated);
  };

  // Host generates questions and starts game
  const handleGenerateQuestions = async () => {
    setLoading(true);
    setError(null);
    setPhase('generating');

    try {
      const pointValues = [200, 400, 600, 800, 1000];
      const result = await aiService.generateQuestions(categories, pointValues, 1);

      const questionGrid = result.categories.map((cat) => {
        return cat.questions.map((q) => ({
          category: cat.name,
          points: q.points,
          answer: q.answer,
          question: q.question,
          revealed: false,
        }));
      });

      setLocalQuestions(questionGrid);

      // Pick random first player
      const playerIds = players.map(p => p.id);
      const firstPickerId = playerIds[Math.floor(Math.random() * playerIds.length)];

      // Broadcast to all players
      socketClient.emit('game:set-questions', {
        roomCode,
        questions: questionGrid,
        categories,
        firstPickerId,
      });

      setCurrentPickerId(firstPickerId);
      setPhase('playing');
    } catch (err) {
      console.error('Error generating questions:', err);
      setError(err.message || 'Failed to generate questions');
      setPhase('categoryEdit');
    } finally {
      setLoading(false);
    }
  };

  // Current picker selects a question
  const handleQuestionSelect = (categoryIndex, pointIndex) => {
    if (currentPickerId !== currentPlayerId) return; // Not my turn
    if (revealedQuestions.has(`${categoryIndex}-${pointIndex}`)) return; // Already revealed

    socketClient.emit('game:select-question', {
      roomCode,
      categoryIndex,
      pointIndex,
    });
  };

  // Player buzzes in
  const handleBuzz = useCallback(() => {
    if (!canBuzz || !signalArrivedTime) return;

    const reactionTime = Date.now() - signalArrivedTime;
    socketClient.emit('game:buzz-in', { roomCode, reactionTime });
    setCanBuzz(false);
  }, [canBuzz, signalArrivedTime, roomCode]);

  // Buzzer winner submits answer
  const handleAnswerResult = (correct) => {
    socketClient.emit('game:submit-answer', {
      roomCode,
      correct,
      points: currentQuestion.points,
    });
    setShowAnswer(false);
  };

  const allPlayersReady = players.length >= 2 &&
    players.every(p => p.isReady || p.isHost);

  const isMyTurn = currentPickerId === currentPlayerId;
  const iAmBuzzerWinner = buzzerWinnerId === currentPlayerId;
  const currentPicker = players.find(p => p.id === currentPickerId);
  const buzzerWinner = players.find(p => p.id === buzzerWinnerId);

  return (
    <div className="game-page">
      {/* Loading Overlay */}
      <AnimatePresence>
        {loading && (
          <motion.div
            className="loading-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="spinner" />
            <p>{phase === 'generating' ? 'Generating questions...' : 'The AI is thinking...'}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="game-header">
        <h1>{phase === 'playing' ? 'Jeoparody!' : 'Game Lobby'}</h1>
        <div className="room-code-badge">
          Room: <span>{roomCode}</span>
        </div>
      </header>

      {/* LOBBY PHASE */}
      {phase === 'lobby' && (
        <div className="game-content">
          <div className="players-section">
            <h2>Players ({players.length})</h2>
            <ul className="player-list">
              {players.map((player) => (
                <motion.li
                  key={player.id}
                  className="player-card"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                >
                  <span className="player-name">
                    {player.displayName || player.name}
                    {player.isHost && <span className="host-tag">Host</span>}
                  </span>
                  <span className={`ready-badge ${player.isReady ? 'ready' : ''}`}>
                    {player.isHost ? 'Host' : player.isReady ? 'Ready' : 'Not Ready'}
                  </span>
                </motion.li>
              ))}
            </ul>

            {players.length === 0 && (
              <p className="waiting-text">Waiting for players to join...</p>
            )}
          </div>

          <div className="actions-section">
            {isHost ? (
              <button
                className="btn-primary btn-large"
                onClick={handleStartSetup}
                disabled={!allPlayersReady}
              >
                {allPlayersReady ? 'Start Game Setup' : 'Waiting for players...'}
              </button>
            ) : (
              <button
                className={`btn-primary btn-large ${isReady ? 'ready' : ''}`}
                onClick={handleToggleReady}
              >
                {isReady ? 'Ready!' : 'Click when Ready'}
              </button>
            )}

            <button className="btn-ghost" onClick={handleLeave}>
              Leave Room
            </button>
          </div>
        </div>
      )}

      {/* WAITING PHASE (non-hosts) */}
      {phase === 'waiting' && (
        <motion.div
          className="waiting-phase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="spinner" />
          <h2>Waiting for host...</h2>
          <p>The host is selecting categories and generating questions.</p>
        </motion.div>
      )}

      {/* SETUP PHASE (host only) */}
      {phase === 'setup' && isHost && (
        <GenreSelector
          onSubmit={handleGenerateCategories}
          error={error}
        />
      )}

      {/* CATEGORY EDIT PHASE (host only) */}
      {phase === 'categoryEdit' && isHost && (
        <CategoryEditor
          categories={categories}
          onEdit={handleCategoryEdit}
          onBack={() => setPhase('setup')}
          onNext={handleGenerateQuestions}
          error={error}
        />
      )}

      {/* GENERATING PHASE */}
      {phase === 'generating' && (
        <motion.div
          className="generating-phase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="spinner" />
          <h2>Generating Questions...</h2>
          <p>The AI is creating {categories.length * 5} questions.</p>
        </motion.div>
      )}

      {/* PLAYING PHASE */}
      {phase === 'playing' && (
        <div className="multiplayer-game">
          {/* Scoreboard */}
          <div className="scoreboard">
            {players.map((player) => (
              <div
                key={player.id}
                className={`scoreboard-player ${player.id === currentPickerId ? 'current-picker' : ''}`}
              >
                <span className="player-name">{player.displayName || player.name}</span>
                <span className={`player-score ${(player.score || 0) >= 0 ? 'positive' : 'negative'}`}>
                  ${(player.score || 0).toLocaleString()}
                </span>
              </div>
            ))}
          </div>

          {/* Turn Indicator */}
          <div className="turn-indicator">
            {currentPicker ? (
              <>
                <span className="turn-label">
                  {isMyTurn ? "Your turn! Pick a question." : `${currentPicker.displayName || currentPicker.name}'s turn to pick`}
                </span>
              </>
            ) : (
              <span className="turn-label">Waiting...</span>
            )}
          </div>

          {/* Game Board */}
          {!currentQuestion && (
            <GameBoard
              categories={categories}
              questions={questions}
              pointValues={[200, 400, 600, 800, 1000]}
              onQuestionSelect={handleQuestionSelect}
              disabled={!isMyTurn}
              revealedQuestions={revealedQuestions}
            />
          )}

          {/* Question Display with Buzzer */}
          {currentQuestion && (
            <div className="question-view">
              <div className="question-card">
                <div className="question-category">{currentQuestion.category}</div>
                <div className="question-points">${currentQuestion.points}</div>
                <div className="question-answer">{currentQuestion.answer}</div>

                {/* Buzzer */}
                {canBuzz && !buzzerWinnerId && (
                  <motion.button
                    className="buzzer-button"
                    onClick={handleBuzz}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                  >
                    BUZZ IN!
                  </motion.button>
                )}

                {/* Buzzer Winner Display */}
                {buzzerWinnerId && (
                  <div className="buzzer-winner-display">
                    <p className="buzzer-winner-text">
                      {iAmBuzzerWinner ? 'You buzzed first!' : `${buzzerWinner?.displayName || buzzerWinner?.name} buzzed first!`}
                    </p>

                    {iAmBuzzerWinner && !showAnswer && (
                      <button className="btn-primary" onClick={() => setShowAnswer(true)}>
                        Reveal Answer
                      </button>
                    )}

                    {iAmBuzzerWinner && showAnswer && (
                      <div className="answer-section">
                        <p className="correct-answer">
                          <span className="answer-label">Answer:</span> {currentQuestion.question}
                        </p>
                        <div className="answer-buttons">
                          <button className="btn-correct" onClick={() => handleAnswerResult(true)}>
                            I Got It Right
                          </button>
                          <button className="btn-incorrect" onClick={() => handleAnswerResult(false)}>
                            I Got It Wrong
                          </button>
                        </div>
                      </div>
                    )}

                    {!iAmBuzzerWinner && (
                      <p className="waiting-for-answer">Waiting for their answer...</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* FINISHED PHASE */}
      {phase === 'finished' && (
        <div className="game-finished">
          <h2>Game Over!</h2>
          <div className="final-standings">
            <h3>Final Standings</h3>
            {[...players]
              .sort((a, b) => (b.score || 0) - (a.score || 0))
              .map((player, index) => (
                <div key={player.id} className={`standing-row ${index === 0 ? 'winner' : ''}`}>
                  <span className="standing-rank">#{index + 1}</span>
                  <span className="standing-name">{player.displayName || player.name}</span>
                  <span className="standing-score">${(player.score || 0).toLocaleString()}</span>
                </div>
              ))}
          </div>
          <div className="finished-actions">
            <button className="btn-primary" onClick={handleLeave}>
              Back to Menu
            </button>
          </div>
        </div>
      )}

      {error && (
        <motion.p
          className="error-message"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {error}
        </motion.p>
      )}
    </div>
  );
}
