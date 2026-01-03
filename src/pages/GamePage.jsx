import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useRoom } from '../hooks';
import { useRoomStore, useGameStore, useUserStore, useSettingsStore } from '../stores';
import { socketClient } from '../services/socket/socketClient';
import * as aiService from '../services/api/aiService';
import { speakText, stopSpeaking } from '../services/ttsService';
import GenreSelector from '../components/setup/GenreSelector';
import CategoryEditor from '../components/setup/CategoryEditor';
import GameSettingsPanel from '../components/setup/GameSettingsPanel';
import GameBoard from '../components/game/GameBoard';
import QuestionModal from '../components/game/QuestionModal';
import GameResults from '../components/game/GameResults';
import DailyDoubleModal from '../components/game/DailyDoubleModal';
import Timer from '../components/common/Timer';
import { mockBoard, isTestModeEnabled } from '../data/mockQuestions';
import './GamePage.css';

export default function GamePage() {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const { leaveRoom, setReady, subscribe, isConnected } = useRoom(roomCode);
  const { players, isHost, resetRoom, settings, updateSettings } = useRoomStore();
  const { setCategories, setQuestions, setPhase: setGamePhase } = useGameStore();
  const sessionId = useUserStore((s) => s.sessionId);
  const currentPlayerId = sessionId || socketClient.getSocketId();
  const textToSpeechEnabled = useSettingsStore((s) => s.textToSpeechEnabled);

  // Game phases: 'lobby' | 'setup' | 'categoryEdit' | 'generating' | 'playing' | 'finished'
  const [phase, setPhase] = useState('lobby');
  const [isReady, setIsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

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
  const [buzzTimerKey, setBuzzTimerKey] = useState(0); // Key to reset timer on new question
  const [answerTimerKey, setAnswerTimerKey] = useState(0); // Key for answer phase timer
  const [buzzTimedOut, setBuzzTimedOut] = useState(false); // Show timeout view with answer
  const [hasContinued, setHasContinued] = useState(false); // Player clicked Continue
  const [waitingForOthers, setWaitingForOthers] = useState(false); // Waiting for other players to continue

  // Daily Double state
  const [isDailyDouble, setIsDailyDouble] = useState(false);
  const [dailyDoubleWager, setDailyDoubleWager] = useState(0);
  const [dailyDoublePhase, setDailyDoublePhase] = useState(null); // 'wager' | 'question' | null
  const [currentRound, setCurrentRound] = useState(1);

  // Final Jeopardy state
  const [finalJeopardyData, setFinalJeopardyData] = useState(null); // { category, clue, answer }
  const [fjPhase, setFjPhase] = useState(null); // 'category' | 'wager' | 'clue' | 'reveal' | null
  const [fjWager, setFjWager] = useState(0);
  const [fjAnswer, setFjAnswer] = useState('');
  const [fjWagerSubmitted, setFjWagerSubmitted] = useState(false);
  const [fjAnswerSubmitted, setFjAnswerSubmitted] = useState(false);
  const [fjResults, setFjResults] = useState(null); // Array of { playerId, playerName, wager, answer, correct, finalScore }

  // Handle settings change (host only)
  const handleSettingsChange = (newSettings) => {
    if (!isHost) return;
    updateSettings(newSettings);
    socketClient.emit('room:update-settings', { roomCode, settings: newSettings });
  };

  // Store room code for reconnection on page reload
  useEffect(() => {
    if (roomCode) {
      localStorage.setItem('jeopardy_current_room', roomCode);
    }
  }, [roomCode]);

  // Auto-reconnect on page load if we have a stored room
  useEffect(() => {
    if (!isConnected || !roomCode) return;

    // Check if we need to attempt reconnection (players array is empty = fresh page load)
    const storedRoom = localStorage.getItem('jeopardy_current_room');
    if (storedRoom === roomCode && players.length === 0) {
      setIsReconnecting(true);

      socketClient.reconnectToRoom(roomCode)
        .then((result) => {
          console.log('Reconnected to room:', result);

          // Restore room state
          if (result.players) {
            useRoomStore.getState().setPlayers(result.players);
          }
          if (result.settings) {
            useRoomStore.getState().updateSettings(result.settings);
          }
          if (result.isHost !== undefined) {
            useRoomStore.getState().setIsHost(result.isHost);
          }

          // Restore game state if game is in progress
          if (result.gameState) {
            const gs = result.gameState;

            // Restore categories and questions
            if (gs.categories) setLocalCategories(gs.categories);
            if (gs.questions) setLocalQuestions(gs.questions);
            if (gs.currentPickerId) setCurrentPickerId(gs.currentPickerId);
            if (gs.currentRound) setCurrentRound(gs.currentRound);

            // Determine phase from game state
            if (gs.phase === 'playing') {
              setPhase('playing');
            } else if (gs.phase === 'finalJeopardy') {
              setPhase('finalJeopardy');
            } else if (gs.phase === 'dailyDouble') {
              setIsDailyDouble(true);
              setDailyDoublePhase('wager');
              setPhase('playing');
            } else {
              setPhase('lobby');
            }
          }

          setIsReconnecting(false);
        })
        .catch((err) => {
          console.log('Reconnection failed:', err.message);
          // Clear stored room if reconnection failed
          localStorage.removeItem('jeopardy_current_room');
          setIsReconnecting(false);
        });
    }
  }, [isConnected, roomCode, players.length]);

  // Subscribe to game events
  useEffect(() => {
    if (!isConnected || !roomCode) return;

    // Settings updated by host
    const unsubSettingsUpdated = subscribe('room:settings-updated', ({ settings: newSettings }) => {
      updateSettings(newSettings);
    });

    // Player reconnected after page reload
    const unsubPlayerReconnected = subscribe('room:player-reconnected', ({ playerId, displayName }) => {
      console.log(`Player ${displayName} reconnected`);
      // Update player's connected status
      useRoomStore.getState().updatePlayer(playerId, { isConnected: true });
    });

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
    const unsubQuestionSelected = subscribe('game:question-selected', ({ categoryIndex, pointIndex, question, isDailyDouble: isDD }) => {
      setCurrentQuestion({ ...question, categoryIndex, pointIndex });
      setRevealedQuestions(prev => new Set([...prev, `${categoryIndex}-${pointIndex}`]));
      setShowAnswer(false);
      // Reset continue states for new question
      setHasContinued(false);
      setWaitingForOthers(false);
      setBuzzTimedOut(false);

      if (isDD) {
        // Daily Double - show wager modal to picker, announcement to others
        setIsDailyDouble(true);
        setDailyDoublePhase('wager');
        setCanBuzz(false);
        setBuzzerWinnerId(null);
        // TTS will be triggered when wager is confirmed
      } else {
        // Regular question - start buzz window
        setIsDailyDouble(false);
        setDailyDoublePhase(null);
        setSignalArrivedTime(Date.now());
        setCanBuzz(true);
        setBuzzerWinnerId(null);
        // Reset timer for new question
        setBuzzTimerKey(prev => prev + 1);
        // Read the clue aloud
        if (textToSpeechEnabled && question?.answer) {
          speakText(question.answer);
        }
      }
    });

    // Someone buzzed first
    const unsubBuzzerWinner = subscribe('game:buzzer-winner', ({ playerId, playerName, reactionTime }) => {
      setBuzzerWinnerId(playerId);
      setCanBuzz(false);
      // Reset answer timer for buzzer winner
      setAnswerTimerKey(prev => prev + 1);
    });

    // Answer result
    const unsubAnswerResult = subscribe('game:answer-result', ({ playerId, correct, newScore, nextPickerId, canBuzzAgain }) => {
      // Update player score in room store
      if (playerId) {
        useRoomStore.getState().updatePlayerScore(playerId, newScore);
      }

      if (correct) {
        setCurrentPickerId(nextPickerId);
        setCurrentQuestion(null);
        setBuzzerWinnerId(null);
      } else if (canBuzzAgain) {
        // Wrong answer, others can buzz
        setBuzzerWinnerId(null);
        setSignalArrivedTime(Date.now());
        setCanBuzz(true);
        // Reset buzz timer for remaining players
        setBuzzTimerKey(prev => prev + 1);
      } else {
        // No one left to buzz, move on
        setCurrentPickerId(nextPickerId);
        setCurrentQuestion(null);
        setBuzzerWinnerId(null);
      }
    });

    // Buzz timeout - no one buzzed in time (server-driven)
    const unsubBuzzTimeout = subscribe('game:buzz-timeout-result', ({ nextPickerId }) => {
      // Don't clear currentQuestion yet - show timeout view with answer first
      setBuzzerWinnerId(null);
      setCanBuzz(false);
      setBuzzTimedOut(true);
      setHasContinued(false);
      setWaitingForOthers(false);
      setCurrentPickerId(nextPickerId);
    });

    // All players clicked Continue - return to board
    const unsubAllContinued = subscribe('game:all-continued', ({ nextPickerId }) => {
      setBuzzTimedOut(false);
      setCurrentQuestion(null);
      setHasContinued(false);
      setWaitingForOthers(false);
      setCurrentPickerId(nextPickerId);
    });

    // Answer revealed by buzzer winner (broadcast to all players)
    const unsubAnswerRevealed = subscribe('game:answer-revealed', ({ playerId, answer }) => {
      setShowAnswer(true);
    });

    // Daily Double wager confirmed - show question to everyone
    const unsubDDWagerConfirmed = subscribe('game:daily-double-wager-confirmed', ({ wager, question }) => {
      setDailyDoubleWager(wager);
      setDailyDoublePhase('question');
      // Read the Daily Double clue aloud
      if (textToSpeechEnabled && question?.answer) {
        speakText(question.answer);
      }
    });

    // Daily Double result - update scores and reset
    const unsubDDResult = subscribe('game:daily-double-result', ({ playerId, correct, wager, newScore, nextPickerId }) => {
      // Update player score
      useRoomStore.getState().updatePlayerScore(playerId, newScore);
      // Reset Daily Double state
      setIsDailyDouble(false);
      setDailyDoublePhase(null);
      setDailyDoubleWager(0);
      setCurrentQuestion(null);
      setCurrentPickerId(nextPickerId);
    });

    // Round 1 ended - show transition screen
    const unsubRoundEnd = subscribe('game:round-ended', ({ round }) => {
      setPhase('roundEnd');
    });

    // Round 2 starting - new questions
    const unsubRound2Start = subscribe('game:round-2-started', ({ questions: newQuestions, categories: newCategories, firstPickerId }) => {
      setLocalCategories(newCategories);
      setLocalQuestions(newQuestions);
      setCurrentPickerId(firstPickerId);
      setCurrentRound(2);
      setRevealedQuestions(new Set());
      setCurrentQuestion(null);
      setPhase('playing');
    });

    // Final Jeopardy - Category reveal
    const unsubFJStart = subscribe('game:final-jeopardy-started', ({ category, clue, answer }) => {
      setFinalJeopardyData({ category, clue, answer });
      setFjPhase('category');
      setFjWager(0);
      setFjAnswer('');
      setFjWagerSubmitted(false);
      setFjAnswerSubmitted(false);
      setFjResults(null);
      setPhase('finalJeopardy');

      // Auto-transition to wager phase after 3 seconds
      setTimeout(() => {
        setFjPhase('wager');
      }, 3000);
    });

    // Final Jeopardy - Show clue (all wagers in)
    const unsubFJShowClue = subscribe('game:fj-show-clue', () => {
      setFjPhase('clue');
    });

    // Final Jeopardy - Reveal results
    const unsubFJReveal = subscribe('game:fj-reveal', ({ results }) => {
      setFjResults(results);
      setFjPhase('reveal');
      // Update all player scores
      results.forEach(result => {
        useRoomStore.getState().updatePlayerScore(result.playerId, result.finalScore);
      });
    });

    // Game ended
    const unsubGameEnded = subscribe('game:ended', () => {
      setPhase('finished');
    });

    return () => {
      unsubSettingsUpdated();
      unsubPlayerReconnected();
      unsubSetupStarted();
      unsubCategoriesSet();
      unsubQuestionsReady();
      unsubQuestionSelected();
      unsubBuzzerWinner();
      unsubAnswerResult();
      unsubBuzzTimeout();
      unsubAllContinued();
      unsubAnswerRevealed();
      unsubDDWagerConfirmed();
      unsubDDResult();
      unsubRoundEnd();
      unsubRound2Start();
      unsubFJStart();
      unsubFJShowClue();
      unsubFJReveal();
      unsubGameEnded();
    };
  }, [isConnected, roomCode, isHost, subscribe, updateSettings]);

  // Check if all questions revealed - handle round transition
  // Only check when no question is currently active (so last question can be played)
  useEffect(() => {
    if (phase === 'playing' && questions.length > 0 && !currentQuestion) {
      const totalQuestions = questions.length * (questions[0]?.length || 0);
      if (revealedQuestions.size >= totalQuestions) {
        // Check if we should go to round 2
        if (currentRound === 1 && settings?.enableDoubleJeopardy && isHost) {
          // Host triggers round 2
          socketClient.emit('game:round-end', { roomCode, round: 1 });
        } else if (currentRound === 2 || !settings?.enableDoubleJeopardy) {
          // Game over - check for Final Jeopardy
          if (settings?.enableFinalJeopardy && isHost) {
            socketClient.emit('game:start-final-jeopardy', { roomCode });
          } else {
            socketClient.emit('game:end', { roomCode });
          }
        }
      }
    }
  }, [revealedQuestions, questions, phase, roomCode, currentRound, settings, isHost, currentQuestion]);

  // Read Final Jeopardy clue when it's shown
  useEffect(() => {
    if (fjPhase === 'clue' && finalJeopardyData?.clue && textToSpeechEnabled) {
      speakText(finalJeopardyData.clue);
    }
  }, [fjPhase, finalJeopardyData, textToSpeechEnabled]);

  const handleLeave = () => {
    // Clear stored room so we don't try to reconnect
    localStorage.removeItem('jeopardy_current_room');
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

  // Host uses test board (no AI credits)
  const handleUseTestBoard = () => {
    const { categories: testCategories, questions: testQuestions } = mockBoard;

    // Pick random first player
    const playerIds = players.map(p => p.id);
    const firstPickerId = playerIds[Math.floor(Math.random() * playerIds.length)];

    // Broadcast to all players via socket
    socketClient.emit('game:set-categories', { roomCode, categories: testCategories });
    socketClient.emit('game:set-questions', {
      roomCode,
      questions: testQuestions,
      categories: testCategories,
      firstPickerId,
    });

    setLocalCategories(testCategories);
    setLocalQuestions(testQuestions);
    setCurrentPickerId(firstPickerId);
    setPhase('playing');
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

  // Host starts Double Jeopardy (Round 2)
  const handleStartRound2 = async () => {
    setLoading(true);
    setError(null);

    try {
      // Generate new categories
      const newCategories = await aiService.generateCategories(genre);

      // Generate questions with doubled point values
      const pointValues = [400, 800, 1200, 1600, 2000];
      const result = await aiService.generateQuestions(newCategories, pointValues, 2);

      const questionGrid = result.categories.map((cat) => {
        return cat.questions.map((q) => ({
          category: cat.name,
          points: q.points,
          answer: q.answer,
          question: q.question,
          revealed: false,
        }));
      });

      // Pick random first player for round 2
      const playerIds = players.map(p => p.id);
      const firstPickerId = playerIds[Math.floor(Math.random() * playerIds.length)];

      // Broadcast round 2 start
      socketClient.emit('game:start-round-2', {
        roomCode,
        questions: questionGrid,
        categories: newCategories,
        firstPickerId,
      });
    } catch (err) {
      console.error('Error starting round 2:', err);
      setError(err.message || 'Failed to start Double Jeopardy');
    } finally {
      setLoading(false);
    }
  };

  // Current picker selects a question
  const handleQuestionSelect = (categoryIndex, pointIndex) => {
    if (currentPickerId !== currentPlayerId) return; // Not my turn
    if (revealedQuestions.has(`${categoryIndex}-${pointIndex}`)) return; // Already revealed

    // Optimistically set buzz state for responsive UI
    // Server is still authoritative for determining buzz winner
    const question = questions[categoryIndex]?.[pointIndex];
    if (question) {
      setCurrentQuestion({ ...question, categoryIndex, pointIndex });
      setRevealedQuestions(prev => new Set([...prev, `${categoryIndex}-${pointIndex}`]));
      setSignalArrivedTime(Date.now());
      setCanBuzz(true);
      setBuzzerWinnerId(null);
      setBuzzTimedOut(false);
      setBuzzTimerKey(prev => prev + 1);
    }

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

  // Buzz timer expired - no one buzzed in time
  const handleBuzzTimeUp = useCallback(() => {
    setCanBuzz(false);
    setBuzzTimedOut(true);  // Show timeout display with answer and Continue button
    // Server may also emit 'game:buzz-timeout-result' if it started its timer
  }, []);

  // Continue after timeout - notify server, wait for all players
  const handleTimeoutContinue = useCallback(() => {
    setHasContinued(true);
    setWaitingForOthers(true);
    socketClient.emit('game:timeout-continue', { roomCode });
  }, [roomCode]);

  // Answer timer expired - buzzer winner took too long
  // Note: Server now handles timeout, this just updates local UI
  const handleAnswerTimeUp = useCallback(() => {
    // Server will emit 'game:answer-result' with timeout: true
    setShowAnswer(false);
  }, []);

  // Reveal answer - broadcasts to all players so everyone sees
  const handleRevealAnswer = useCallback(() => {
    socketClient.emit('game:reveal-answer', { roomCode });
  }, [roomCode]);

  // Daily Double wager confirmed
  const handleDailyDoubleWager = useCallback((wager) => {
    socketClient.emit('game:daily-double-wager', {
      roomCode,
      wager,
    });
  }, [roomCode]);

  // Daily Double answer submitted
  const handleDailyDoubleAnswer = useCallback((correct) => {
    socketClient.emit('game:daily-double-answer', {
      roomCode,
      correct,
    });
    setShowAnswer(false);
  }, [roomCode]);

  // Final Jeopardy wager submitted
  const handleFJWagerSubmit = useCallback(() => {
    const myScore = players.find(p => p.id === currentPlayerId)?.score || 0;
    const maxWager = Math.max(myScore, 0);
    const validWager = Math.min(Math.max(0, fjWager), maxWager);

    socketClient.emit('game:fj-wager', {
      roomCode,
      wager: validWager,
    });
    setFjWagerSubmitted(true);
  }, [roomCode, fjWager, players, currentPlayerId]);

  // Final Jeopardy answer submitted
  const handleFJAnswerSubmit = useCallback(() => {
    socketClient.emit('game:fj-answer', {
      roomCode,
      answer: fjAnswer,
    });
    setFjAnswerSubmitted(true);
  }, [roomCode, fjAnswer]);

  // Final Jeopardy timeout handlers
  const handleFJWagerTimeUp = useCallback(() => {
    if (!fjWagerSubmitted) {
      // Auto-submit $0 wager
      socketClient.emit('game:fj-wager', {
        roomCode,
        wager: 0,
      });
      setFjWagerSubmitted(true);
    }
  }, [roomCode, fjWagerSubmitted]);

  const handleFJAnswerTimeUp = useCallback(() => {
    if (!fjAnswerSubmitted) {
      // Auto-submit empty answer
      socketClient.emit('game:fj-answer', {
        roomCode,
        answer: '',
      });
      setFjAnswerSubmitted(true);
    }
  }, [roomCode, fjAnswerSubmitted]);

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
        {(loading || isReconnecting) && (
          <motion.div
            className="loading-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="spinner" />
            <p>
              {isReconnecting
                ? 'Reconnecting to game...'
                : phase === 'generating'
                  ? 'Generating questions...'
                  : 'The AI is thinking...'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="game-header">
        <h1>
          {phase === 'playing' || phase === 'roundEnd'
            ? (currentRound === 2 ? 'Double Jeoparody!' : 'Jeoparody!')
            : 'Game Lobby'}
        </h1>
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

          {/* Game Settings */}
          <div className="settings-section">
            <GameSettingsPanel
              settings={settings}
              onSettingsChange={handleSettingsChange}
              readOnly={!isHost}
              defaultExpanded={isHost}
            />
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
        <div className="setup-container">
          <GenreSelector
            onSubmit={handleGenerateCategories}
            error={error}
          />
          {isTestModeEnabled() && (
            <button className="btn-ghost test-board-btn" onClick={handleUseTestBoard}>
              Use Test Board (No AI)
            </button>
          )}
        </div>
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

      {/* ROUND END PHASE - Transition to Double Jeopardy */}
      {phase === 'roundEnd' && (
        <motion.div
          className="round-end-phase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <motion.div
            className="round-end-content"
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', damping: 15 }}
          >
            <h2>Round 1 Complete!</h2>
            <div className="round-standings">
              <h3>Current Standings</h3>
              {[...players]
                .sort((a, b) => (b.score || 0) - (a.score || 0))
                .map((player, index) => (
                  <div key={player.id} className={`standing-row ${index === 0 ? 'leader' : ''}`}>
                    <span className="standing-rank">#{index + 1}</span>
                    <span className="standing-name">{player.displayName || player.name}</span>
                    <span className="standing-score">${(player.score || 0).toLocaleString()}</span>
                  </div>
                ))}
            </div>

            {isHost ? (
              <motion.button
                className="btn-primary btn-large"
                onClick={handleStartRound2}
                disabled={loading}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {loading ? 'Generating...' : 'Start Double Jeopardy!'}
              </motion.button>
            ) : (
              <p className="waiting-text">Waiting for host to start Double Jeopardy...</p>
            )}
          </motion.div>
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
            {currentQuestion && !isDailyDouble ? (
              <span className="turn-label">
                {buzzerWinnerId
                  ? (iAmBuzzerWinner ? 'Your turn to answer!' : `${buzzerWinner?.displayName || buzzerWinner?.name} is answering...`)
                  : buzzTimedOut
                    ? "Time's up!"
                    : 'Buzz in to answer!'}
              </span>
            ) : currentPicker ? (
              <span className="turn-label">
                {isMyTurn ? "Your turn! Pick a question." : `${currentPicker.displayName || currentPicker.name}'s turn to pick`}
              </span>
            ) : (
              <span className="turn-label">Waiting...</span>
            )}
          </div>

          {/* Game Board */}
          {!currentQuestion && (
            <GameBoard
              categories={categories}
              questions={questions}
              pointValues={currentRound === 1 ? [200, 400, 600, 800, 1000] : [400, 800, 1200, 1600, 2000]}
              onQuestionSelect={handleQuestionSelect}
              disabled={!isMyTurn}
              revealedQuestions={revealedQuestions}
            />
          )}

          {/* Daily Double - Wager Phase */}
          {isDailyDouble && dailyDoublePhase === 'wager' && currentQuestion && (
            isMyTurn ? (
              <DailyDoubleModal
                question={currentQuestion}
                currentScore={players.find(p => p.id === currentPlayerId)?.score || 0}
                currentRound={currentRound}
                onWagerConfirm={handleDailyDoubleWager}
              />
            ) : (
              <div className="daily-double-waiting">
                <motion.div
                  className="daily-double-announcement"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', damping: 15 }}
                >
                  <h2>DAILY DOUBLE!</h2>
                  <p>{currentPicker?.displayName || currentPicker?.name} is making their wager...</p>
                </motion.div>
              </div>
            )
          )}

          {/* Daily Double - Question Phase */}
          {isDailyDouble && dailyDoublePhase === 'question' && currentQuestion && (
            <div className="question-view">
              <div className="question-card daily-double-card">
                <div className="daily-double-badge">DAILY DOUBLE - ${dailyDoubleWager.toLocaleString()}</div>
                <div className="question-category">{currentQuestion.category}</div>
                <div className="question-answer">{currentQuestion.answer}</div>

                {isMyTurn && !showAnswer && (
                  <button className="btn-primary" onClick={() => setShowAnswer(true)}>
                    Reveal Answer
                  </button>
                )}

                {isMyTurn && showAnswer && (
                  <div className="answer-section">
                    <p className="correct-answer">
                      <span className="answer-label">Answer:</span> {currentQuestion.question}
                    </p>
                    <div className="answer-buttons">
                      <button className="btn-correct" onClick={() => handleDailyDoubleAnswer(true)}>
                        I Got It Right (+${dailyDoubleWager.toLocaleString()})
                      </button>
                      <button className="btn-incorrect" onClick={() => handleDailyDoubleAnswer(false)}>
                        I Got It Wrong (-${dailyDoubleWager.toLocaleString()})
                      </button>
                    </div>
                  </div>
                )}

                {!isMyTurn && (
                  <p className="waiting-for-answer">
                    Waiting for {currentPicker?.displayName || currentPicker?.name}'s answer...
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Regular Question Display with Buzzer */}
          {currentQuestion && !isDailyDouble && (
            <div className="question-view">
              <div className="question-card">
                <div className="question-category">{currentQuestion.category}</div>
                <div className="question-points">${currentQuestion.points}</div>
                <div className="question-answer">{currentQuestion.answer}</div>

                {/* Buzz Timer - shown during buzz phase */}
                {canBuzz && !buzzerWinnerId && !buzzTimedOut && settings?.questionTimeLimit && (
                  <div className="buzz-timer-container">
                    <Timer
                      key={`buzz-${buzzTimerKey}`}
                      duration={settings.questionTimeLimit}
                      onTimeUp={handleBuzzTimeUp}
                      autoStart={true}
                      size="medium"
                    />
                  </div>
                )}

                {/* Buzzer */}
                {canBuzz && !buzzerWinnerId && !buzzTimedOut && (
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

                    {/* Answer Timer - buzzer winner has limited time to answer */}
                    {iAmBuzzerWinner && !showAnswer && settings?.questionTimeLimit && (
                      <div className="answer-timer-container">
                        <Timer
                          key={`answer-${answerTimerKey}`}
                          duration={settings.questionTimeLimit}
                          onTimeUp={handleAnswerTimeUp}
                          autoStart={true}
                          size="small"
                        />
                      </div>
                    )}

                    {iAmBuzzerWinner && !showAnswer && (
                      <button className="btn-primary" onClick={handleRevealAnswer}>
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

                {/* Timeout - No One Buzzed */}
                {buzzTimedOut && (
                  <div className="timeout-display">
                    <p className="timeout-message">Time's Up! No one buzzed in.</p>
                    <div className="answer-section">
                      <p className="correct-answer">
                        <span className="answer-label">Answer:</span> {currentQuestion.question}
                      </p>
                    </div>
                    {!hasContinued ? (
                      <button className="btn-primary" onClick={handleTimeoutContinue}>
                        Continue
                      </button>
                    ) : (
                      <p className="waiting-text">Waiting for other players...</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* FINAL JEOPARDY PHASE */}
      {phase === 'finalJeopardy' && finalJeopardyData && (
        <div className="final-jeopardy-container">
          {/* Category Reveal */}
          {fjPhase === 'category' && (
            <motion.div
              className="fj-category-reveal"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', damping: 15 }}
            >
              <h2>FINAL JEOPARDY!</h2>
              <p className="fj-category-label">Category:</p>
              <h3 className="fj-category-name">{finalJeopardyData.category}</h3>
            </motion.div>
          )}

          {/* Wager Phase */}
          {fjPhase === 'wager' && (
            <motion.div
              className="fj-wager-phase"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <h2>FINAL JEOPARDY</h2>
              <p className="fj-category-display">Category: {finalJeopardyData.category}</p>

              {!fjWagerSubmitted ? (
                <div className="fj-wager-form">
                  <p className="fj-your-score">
                    Your Score: ${(players.find(p => p.id === currentPlayerId)?.score || 0).toLocaleString()}
                  </p>
                  <p className="fj-max-wager">
                    Maximum Wager: ${Math.max(players.find(p => p.id === currentPlayerId)?.score || 0, 0).toLocaleString()}
                  </p>

                  {settings?.finalJeopardyTimeLimit && (
                    <div className="fj-timer-container">
                      <Timer
                        key="fj-wager"
                        duration={settings.finalJeopardyTimeLimit}
                        onTimeUp={handleFJWagerTimeUp}
                        autoStart={true}
                        size="medium"
                      />
                    </div>
                  )}

                  <div className="fj-wager-input-group">
                    <label>Your Wager: $</label>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(players.find(p => p.id === currentPlayerId)?.score || 0, 0)}
                      value={fjWager}
                      onChange={(e) => setFjWager(parseInt(e.target.value) || 0)}
                      className="fj-wager-input"
                    />
                  </div>

                  <button className="btn-primary btn-large" onClick={handleFJWagerSubmit}>
                    Lock In Wager
                  </button>
                </div>
              ) : (
                <div className="fj-waiting">
                  <p>Wager locked in: ${fjWager.toLocaleString()}</p>
                  <p className="fj-waiting-text">Waiting for other players...</p>
                </div>
              )}
            </motion.div>
          )}

          {/* Clue Phase - Answer the question */}
          {fjPhase === 'clue' && (
            <motion.div
              className="fj-clue-phase"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <h2>FINAL JEOPARDY</h2>
              <p className="fj-category-display">{finalJeopardyData.category}</p>
              <div className="fj-clue-display">{finalJeopardyData.clue}</div>

              {!fjAnswerSubmitted ? (
                <div className="fj-answer-form">
                  {settings?.finalJeopardyTimeLimit && (
                    <div className="fj-timer-container">
                      <Timer
                        key="fj-answer"
                        duration={settings.finalJeopardyTimeLimit}
                        onTimeUp={handleFJAnswerTimeUp}
                        autoStart={true}
                        size="medium"
                      />
                    </div>
                  )}

                  <div className="fj-answer-input-group">
                    <label>What is...</label>
                    <input
                      type="text"
                      value={fjAnswer}
                      onChange={(e) => setFjAnswer(e.target.value)}
                      placeholder="Enter your answer"
                      className="fj-answer-input"
                    />
                  </div>

                  <button className="btn-primary btn-large" onClick={handleFJAnswerSubmit}>
                    Submit Answer
                  </button>
                </div>
              ) : (
                <div className="fj-waiting">
                  <p>Answer submitted!</p>
                  <p className="fj-waiting-text">Waiting for other players...</p>
                </div>
              )}
            </motion.div>
          )}

          {/* Reveal Phase - Show all results */}
          {fjPhase === 'reveal' && fjResults && (
            <motion.div
              className="fj-reveal-phase"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <h2>FINAL JEOPARDY - RESULTS</h2>
              <p className="fj-correct-answer">
                Correct Answer: <span>{finalJeopardyData.answer}</span>
              </p>

              <div className="fj-results-list">
                {fjResults.map((result, index) => (
                  <motion.div
                    key={result.playerId}
                    className={`fj-result-card ${result.correct ? 'correct' : 'incorrect'}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.5 }}
                  >
                    <div className="fj-result-name">{result.playerName}</div>
                    <div className="fj-result-answer">"{result.answer || '(no answer)'}"</div>
                    <div className="fj-result-wager">
                      Wagered: ${result.wager.toLocaleString()}
                      <span className={result.correct ? 'gain' : 'loss'}>
                        {result.correct ? ` +$${result.wager.toLocaleString()}` : ` -$${result.wager.toLocaleString()}`}
                      </span>
                    </div>
                    <div className="fj-result-final">
                      Final Score: ${result.finalScore.toLocaleString()}
                    </div>
                  </motion.div>
                ))}
              </div>

              <button
                className="btn-primary btn-large"
                onClick={() => {
                  setPhase('finished');
                  socketClient.emit('game:end', { roomCode });
                }}
              >
                See Final Standings
              </button>
            </motion.div>
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
