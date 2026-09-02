import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore, useUserStore, useSettingsStore } from '../stores';
import { useAudio } from '../hooks';
import * as aiService from '../services/api/aiService';
import GameBoard from '../components/game/GameBoard';
import BoardWheel from '../components/game/BoardWheel';
import { useMediaQuery } from '../hooks/useMediaQuery';
import GenreSelector from '../components/setup/GenreSelector';
import CategoryEditor from '../components/setup/CategoryEditor';
import GameSettingsPanel from '../components/setup/GameSettingsPanel';
import QuestionModal from '../components/game/QuestionModal';
import DailyDoubleModal from '../components/game/DailyDoubleModal';
import FinalJeopardyModal from '../components/game/FinalJeopardyModal';
import GameResults from '../components/game/GameResults';
import { mockBoard, isTestModeEnabled } from '../data/mockQuestions';
import { boardToHost } from '../stores/boardShape';
import { countPlay } from '../services/api/boardsService';
import { usePageTitle } from '../hooks/usePageTitle';
import './SinglePlayerPage.css';

export default function SinglePlayerPage() {
  usePageTitle('Single Player');
  const navigate = useNavigate();
  const location = useLocation();
  /* Same breakpoint the daily board uses. A six by five grid needs about 600px
     to be legible and a phone gives about 360, which is why the board turns
     instead. See BoardWheel. */
  const isPhone = useMediaQuery('(max-width: 768px)');
  const {
    phase,
    genre,
    categories,
    questions,
    currentQuestion,
    showAnswer,
    dailyDoubleWager,
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

  const { updateStats, addHighscore, token } = useUserStore();
  const { playCorrect, playWrong } = useAudio();
  const { enableDoubleJeopardy, enableDailyDouble, enableFinalJeopardy, difficulty } =
    useSettingsStore();

  // Final Jeopardy state
  const [finalJeopardyData, setFinalJeopardyData] = useState(null);
  /* A community board brings its own Final Jeopardy, or brings none. Held in a
     ref rather than state because it is set during the mount effect and only
     ever read later. */
  const boardFinal = useRef(null);

  // Category re-roll state
  const [remainingRolls, setRemainingRolls] = useState(5);
  const [regeneratingIndex, setRegeneratingIndex] = useState(null);

  /* One effect, not two.

     A board handed over from its own page used to be applied in a second
     effect that ran after this one. Under StrictMode React mounts, unmounts
     and mounts again, so on the second pass this effect reset the phase back
     to setup while the guard in the other one stopped it re-applying: the
     board arrived and the genre picker appeared anyway. Doing both here means
     there is no order to get wrong.

     A saved board is a third content source rather than a second game. It
     fills the same store the AI path fills and skips the steps that exist only
     to produce one, so nothing downstream knows the difference. */
  useEffect(() => {
    setMode('single');

    const handed = location.state?.board;
    if (handed) {
      const { categories: names, questions: grid } = boardToHost(handed);
      boardFinal.current = handed.finalJeopardy ?? null;
      setGenre(handed.title || 'Community board');
      setCategories(names);
      setQuestions(grid, enableDailyDouble);
      setPhase('playing');

      /* Never awaited and never surfaced. A board that played fine but failed
         to increment a counter is not worth interrupting anyone over. */
      if (location.state.boardSlug) countPlay(location.state.boardSlug, token);
    } else {
      boardFinal.current = null;
      setPhase('setup');
    }

    return () => resetGame();
  }, [
    location.state, setMode, setPhase, resetGame,
    setGenre, setCategories, setQuestions, enableDailyDouble, token,
  ]);

  const handleGenerateCategories = async (selectedGenre) => {
    setLoading(true);
    setError(null);

    try {
      const generatedCategories = await aiService.generateCategories(selectedGenre);
      setGenre(selectedGenre);
      setCategories(generatedCategories);
      setRemainingRolls(5);
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
      const result = await aiService.generateQuestions(categories, pointValues, currentRound, difficulty);

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

      setQuestions(questionGrid, enableDailyDouble);
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

  const handleRegenerateCategory = async (index) => {
    if (remainingRolls <= 0 || regeneratingIndex !== null) return;
    setRegeneratingIndex(index);
    try {
      const newCategory = await aiService.regenerateCategory(genre, categories, index);
      const updated = [...categories];
      updated[index] = newCategory;
      setCategories(updated);
      setRemainingRolls(prev => prev - 1);
    } catch (err) {
      setError('Failed to regenerate category. Please try again.');
    } finally {
      setRegeneratingIndex(null);
    }
  };

  const handleQuestionSelect = (categoryIndex, pointIndex) => {
    selectQuestion(categoryIndex, pointIndex);
  };

  const handleAnswerResult = (correct) => {
    if (correct) {
      playCorrect();
      markCorrect();
    } else {
      playWrong();
      markIncorrect();
    }
  };

  const handleCloseQuestion = () => {
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
      const result = await aiService.generateQuestions(newCategories, pointValues, 2, difficulty);

      const questionGrid = result.categories.map((cat) => {
        return cat.questions.map((q) => ({
          category: cat.name,
          points: q.points,
          answer: q.answer,
          question: q.question,
          revealed: false,
        }));
      });

      startRound2(newCategories, questionGrid, enableDailyDouble);
    } catch (err) {
      console.error('Error generating Double Jeopardy:', err);
      setError(err.message || 'Failed to generate Double Jeopardy. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /* Whether there is a Final Jeopardy to play at all.

     A board somebody else wrote either has one or it does not. Asking a model
     to invent one is putting words in their mouth and billing us for it, so a
     community board with no Final Jeopardy simply ends after the last clue. */
  const playingSomeoneElsesBoard = Boolean(location.state?.board);
  const canPlayFinalJeopardy = playingSomeoneElsesBoard
    ? Boolean(boardFinal.current)
    : true;

  const handleStartFinalJeopardy = async () => {
    // Only eligible if score >= 0 or we allow negative scores to play
    setError(null);

    if (boardFinal.current) {
      setFinalJeopardyData(boardFinal.current);
      setPhase('finalJeopardy');
      return;
    }

    setLoading(true);
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
    setQuestions(mockBoard.questions, enableDailyDouble);
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
          onRegenerate={handleRegenerateCategory}
          remainingRolls={remainingRolls}
          regeneratingIndex={regeneratingIndex}
        />
      )}

      {/* Game Board */}
      {phase === 'playing' && (isPhone ? (
        /* The same wheel the daily board uses. Community boards used to come
           through here and get the desktop grid squeezed onto a phone, because
           this page never had the phone branch the daily board got. */
        <div className="wheel-stage sp-wheel">
          <BoardWheel
            categories={categories}
            answers={questions.flatMap((category) => category.map((q) => ({
              revealed: Boolean(q.revealed),
              passed: q.revealed && q.correct === undefined,
              correct: q.correct === true,
            })))}
            pointValues={getPointValues()}
            onSelect={handleQuestionSelect}
          />
        </div>
      ) : (
        <GameBoard
          categories={categories}
          questions={questions}
          pointValues={getPointValues()}
          onQuestionSelect={handleQuestionSelect}
          onNewGame={handleBackToMenu}
        />
      ))}

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
          ) : enableFinalJeopardy && canPlayFinalJeopardy && score >= 0 ? (
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
          {enableFinalJeopardy && canPlayFinalJeopardy && score < 0 && (
            <p className="fj-ineligible">
              (Final Jeopardy requires a non-negative score)
            </p>
          )}
          {enableFinalJeopardy && !canPlayFinalJeopardy && (
            <p className="fj-ineligible">
              This board has no Final Jeopardy, so the game ends here.
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
            // A confirmed Daily Double wager replaces the board value as the stake.
            points={dailyDoubleWager > 0 ? dailyDoubleWager : currentQuestion.points}
            isDailyDouble={dailyDoubleWager > 0}
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
