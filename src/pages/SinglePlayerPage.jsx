import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore, useUserStore, useSettingsStore } from '../stores';
import * as aiService from '../services/api/aiService';
import { speakText, stopSpeaking } from '../services/ttsService';
import GameBoard from '../components/game/GameBoard';
import GenreSelector from '../components/setup/GenreSelector';
import CategoryEditor from '../components/setup/CategoryEditor';
import GameSettingsPanel from '../components/setup/GameSettingsPanel';
import QuestionModal from '../components/game/QuestionModal';
import DailyDoubleModal from '../components/game/DailyDoubleModal';
import FinalJeopardyModal from '../components/game/FinalJeopardyModal';
import GameResults from '../components/game/GameResults';
import { mockBoard, isTestModeEnabled } from '../data/mockQuestions';
import './SinglePlayerPage.css';

export default function SinglePlayerPage() {
  const navigate = useNavigate();
  const {
    phase,
    genre,
    categories,
    questions,
    currentQuestion,
    showAnswer,
    score,
    currentRound,
    loading,
    error,
    dailyDoubles,
    setMode,
    setGenre,
    setCategories,
    setQuestions,
    setPhase,
    setLoading,
    setError,
    selectQuestion,
    revealAnswer,
    markCorrect,
    markIncorrect,
    closeQuestion,
    resetGame,
    startRound2,
    getPointValues,
    questionsAttempted,
    questionsCorrect,
  } = useGameStore();

  const { updateStats, addHighscore } = useUserStore();
  const { enableDoubleJeopardy, enableFinalJeopardy, textToSpeechEnabled } = useSettingsStore();

  // Final Jeopardy state
  const [finalJeopardyData, setFinalJeopardyData] = useState(null);

  useEffect(() => {
    setMode('single');
    setPhase('setup');
    return () => resetGame();
  }, []);

  // Read Final Jeopardy clue when it's shown
  useEffect(() => {
    if (phase === 'finalJeopardy' && finalJeopardyData?.answer && textToSpeechEnabled) {
      // Small delay to let the category reveal animation play first
      const timer = setTimeout(() => {
        speakText(finalJeopardyData.answer);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [phase, finalJeopardyData, textToSpeechEnabled]);

  const handleGenerateCategories = async (selectedGenre) => {
    setLoading(true);
    setError(null);

    try {
      const generatedCategories = await aiService.generateCategories(selectedGenre);
      setGenre(selectedGenre);
      setCategories(generatedCategories);
      setPhase('categoryEdit');
    } catch (err) {
      console.error('Error generating categories:', err);
      setError(err.message || 'Failed to generate categories. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateQuestions = async () => {
    setLoading(true);
    setError(null);

    try {
      const pointValues = getPointValues();
      const result = await aiService.generateQuestions(categories, pointValues, currentRound);

      // Transform AI response into our grid format
      const questionGrid = result.categories.map((cat) => {
        return cat.questions.map((q) => ({
          category: cat.name,
          points: q.points,
          answer: q.answer,
          question: q.question,
          revealed: false,
        }));
      });

      setQuestions(questionGrid);
      setPhase('playing');
    } catch (err) {
      console.error('Error generating questions:', err);
      setError(err.message || 'Failed to generate questions. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryEdit = (index, newValue) => {
    const updatedCategories = [...categories];
    updatedCategories[index] = newValue;
    setCategories(updatedCategories);
  };

  const handleQuestionSelect = (categoryIndex, pointIndex) => {
    selectQuestion(categoryIndex, pointIndex);
    // Read the clue aloud if TTS is enabled
    if (textToSpeechEnabled) {
      const question = questions[categoryIndex]?.[pointIndex];
      if (question?.answer) {
        speakText(question.answer);
      }
    }
  };

  const handleAnswerResult = (correct) => {
    if (correct) {
      markCorrect();
    } else {
      markIncorrect();
    }
  };

  const handleCloseQuestion = () => {
    stopSpeaking();
    closeQuestion();
  };

  const handleNextRound = async () => {
    if (!enableDoubleJeopardy) {
      // Skip to results
      handleGameEnd();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Generate new categories for Double Jeopardy
      const newCategories = await aiService.generateCategories(genre);
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

      startRound2(newCategories, questionGrid);
    } catch (err) {
      console.error('Error generating Double Jeopardy:', err);
      setError(err.message || 'Failed to generate Double Jeopardy. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartFinalJeopardy = async () => {
    // Only eligible if score >= 0 or we allow negative scores to play
    setLoading(true);
    setError(null);

    try {
      const fjData = await aiService.generateFinalJeopardyQuestion(genre);
      setFinalJeopardyData(fjData);
      setPhase('finalJeopardy');
    } catch (err) {
      console.error('Error generating Final Jeopardy:', err);
      setError(err.message || 'Failed to generate Final Jeopardy. Please try again.');
      // Fall back to game end
      handleGameEnd();
    } finally {
      setLoading(false);
    }
  };

  const handleFinalJeopardyComplete = (result) => {
    // Update the score based on Final Jeopardy result
    const newScore = result.finalScore;

    // Save stats and highscore with final score
    updateStats({
      score: newScore,
      won: true,
      questionsCorrect: questionsCorrect + (result.isCorrect ? 1 : 0),
      questionsTotal: questionsAttempted + 1,
    });

    addHighscore({
      score: newScore,
      genre,
      questionsCorrect: questionsCorrect + (result.isCorrect ? 1 : 0),
      questionsTotal: questionsAttempted + 1,
      rounds: currentRound,
      includedFinalJeopardy: true,
    });

    // Update the game store score for display
    useGameStore.getState().setScore(newScore);
    setFinalJeopardyData(null);
    setPhase('finished');
  };

  const handleGameEnd = () => {
    // Save stats and highscore
    updateStats({
      score,
      won: true, // Single player always "wins"
      questionsCorrect,
      questionsTotal: questionsAttempted,
    });

    addHighscore({
      score,
      genre,
      questionsCorrect,
      questionsTotal: questionsAttempted,
      rounds: currentRound,
    });

    setPhase('finished');
  };

  const handlePlayAgain = () => {
    resetGame();
    setMode('single');
    setPhase('setup');
  };

  const handleBackToMenu = () => {
    resetGame();
    navigate('/menu');
  };

  // Load test board without using AI credits
  const handleUseTestBoard = () => {
    setGenre(mockBoard.genre);
    setCategories(mockBoard.categories);
    setQuestions(mockBoard.questions);
    setPhase('playing');
  };

  return (
    <div className="single-player-page">
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
            <p>The AI is thinking...</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="game-header">
        <h1>{currentRound === 2 ? 'Double Jeopardy!' : 'Jeoparody!'}</h1>
        {phase === 'playing' && (
          <div className="score-display">
            Score: <span className={score >= 0 ? 'positive' : 'negative'}>${score.toLocaleString()}</span>
          </div>
        )}
      </header>

      {/* Genre Selection */}
      {phase === 'setup' && (
        <div className="setup-container">
          <GenreSelector
            onSubmit={handleGenerateCategories}
            error={error}
          />
          <GameSettingsPanel />
          {isTestModeEnabled() && (
            <button className="btn-ghost test-board-btn" onClick={handleUseTestBoard}>
              Use Test Board (No AI)
            </button>
          )}
        </div>
      )}

      {/* Category Editor */}
      {phase === 'categoryEdit' && (
        <CategoryEditor
          categories={categories}
          onEdit={handleCategoryEdit}
          onBack={() => setPhase('setup')}
          onNext={handleGenerateQuestions}
          error={error}
        />
      )}

      {/* Game Board */}
      {phase === 'playing' && (
        <GameBoard
          categories={categories}
          questions={questions}
          pointValues={getPointValues()}
          onQuestionSelect={handleQuestionSelect}
          onNewGame={handleBackToMenu}
        />
      )}

      {/* Round End */}
      {phase === 'roundEnd' && (
        <motion.div
          className="round-end"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <h2>Round {currentRound} Complete!</h2>
          <p className="round-score">
            Current Score: <span>${score.toLocaleString()}</span>
          </p>
          {currentRound === 1 && enableDoubleJeopardy ? (
            <button onClick={handleNextRound} className="btn-primary">
              Continue to Double Jeopardy
            </button>
          ) : enableFinalJeopardy && score >= 0 ? (
            <div className="round-end-buttons">
              <button onClick={handleStartFinalJeopardy} className="btn-primary">
                Play Final Jeopardy!
              </button>
              <button onClick={handleGameEnd} className="btn-secondary">
                Skip to Results
              </button>
            </div>
          ) : (
            <button onClick={handleGameEnd} className="btn-primary">
              See Final Results
            </button>
          )}
          {enableFinalJeopardy && score < 0 && (
            <p className="fj-ineligible">
              (Final Jeopardy requires a non-negative score)
            </p>
          )}
        </motion.div>
      )}

      {/* Game Results */}
      {phase === 'finished' && (
        <GameResults
          score={score}
          questionsCorrect={questionsCorrect}
          questionsAttempted={questionsAttempted}
          genre={genre}
          onPlayAgain={handlePlayAgain}
          onBackToMenu={handleBackToMenu}
        />
      )}

      {/* Question Modal */}
      <AnimatePresence>
        {currentQuestion && phase === 'questionActive' && (
          <QuestionModal
            question={currentQuestion}
            showAnswer={showAnswer}
            onRevealAnswer={revealAnswer}
            onCorrect={() => {
              handleAnswerResult(true);
              handleCloseQuestion();
            }}
            onIncorrect={() => {
              handleAnswerResult(false);
              handleCloseQuestion();
            }}
            onClose={handleCloseQuestion}
          />
        )}
      </AnimatePresence>

      {/* Daily Double Modal */}
      <AnimatePresence>
        {phase === 'dailyDouble' && currentQuestion && (
          <DailyDoubleModal
            question={currentQuestion}
            currentScore={score}
            currentRound={currentRound}
            onWagerConfirm={(wager) => {
              useGameStore.getState().setDailyDoubleWager(wager);
              useGameStore.getState().confirmDailyDoubleWager();
              // Read the clue aloud for Daily Double
              if (textToSpeechEnabled && currentQuestion?.answer) {
                speakText(currentQuestion.answer);
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Final Jeopardy Modal */}
      <AnimatePresence>
        {phase === 'finalJeopardy' && finalJeopardyData && (
          <FinalJeopardyModal
            category={finalJeopardyData.category}
            clue={finalJeopardyData.answer}
            correctAnswer={finalJeopardyData.question}
            currentScore={score}
            onComplete={handleFinalJeopardyComplete}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
