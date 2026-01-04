import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useDailyStore } from '../stores/dailyStore';
import { useSettingsStore } from '../stores/settingsStore';
import { getOrFetchDailyChallenge } from '../services/api/jeopardyService';
import { checkAnswer } from '../services/answerChecker';
import { speakText, stopSpeaking } from '../services/ttsService';
import DailyResults from '../components/daily/DailyResults';
import './DailyPage.css';

export default function DailyPage() {
  const navigate = useNavigate();
  const [userInput, setUserInput] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [lastCheckResult, setLastCheckResult] = useState(null);
  const [verifyCode, setVerifyCode] = useState(null);

  // Parse verification code from URL (for viewing sharer's answers)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('verify');
    if (code) setVerifyCode(code);
  }, []);

  const {
    todayDate,
    questions,
    currentIndex,
    answers,
    isLoading,
    isComplete,
    error,
    stats,
    hasPlayedToday,
    isNewDay,
    setLoading,
    setError,
    setDailyChallenge,
    setUserAnswer,
    revealAnswer,
    overrideAnswer,
    nextQuestion,
    completeGame,
  } = useDailyStore();

  // Format today's date for display
  const formatDisplayDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Load daily challenge on mount
  useEffect(() => {
    const loadChallenge = async () => {
      // If already played today, show results
      if (hasPlayedToday()) {
        return;
      }

      // If new day or no data, fetch fresh
      if (isNewDay() || questions.length === 0) {
        setLoading(true);
        try {
          const challenge = await getOrFetchDailyChallenge();
          setDailyChallenge(challenge);
        } catch (err) {
          console.error('Failed to load daily challenge:', err);
          setError('Failed to load today\'s challenge. Please try again.');
        }
      }
    };

    loadChallenge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Get TTS setting
  const textToSpeechEnabled = useSettingsStore((state) => state.textToSpeechEnabled);

  // Reset input when moving to next question
  useEffect(() => {
    setUserInput('');
    setShowResult(false);
    setLastCheckResult(null);
  }, [currentIndex]);

  // Speak the clue when question changes
  useEffect(() => {
    if (textToSpeechEnabled && questions[currentIndex]?.clue && !showResult) {
      // Small delay to let the animation play
      const timer = setTimeout(() => {
        speakText(questions[currentIndex].clue);
      }, 400);
      return () => {
        clearTimeout(timer);
        stopSpeaking();
      };
    }
  }, [currentIndex, questions, textToSpeechEnabled, showResult]);

  // Stop speaking on unmount
  useEffect(() => {
    return () => stopSpeaking();
  }, []);

  const currentQuestion = questions[currentIndex];
  const currentAnswer = answers[currentIndex];
  const allRevealed = answers.every((a) => a.revealed);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    if (!userInput.trim() || !currentQuestion) return;

    // Stop TTS when answering
    stopSpeaking();

    // Store the user's answer
    setUserAnswer(currentIndex, userInput.trim());

    // Check the answer
    const result = checkAnswer(userInput.trim(), currentQuestion.answer);
    setLastCheckResult(result);

    // Reveal and grade
    revealAnswer(currentIndex, result.isCorrect, userInput.trim());
    setShowResult(true);
  }, [userInput, currentQuestion, currentIndex, setUserAnswer, revealAnswer]);

  const handleOverride = useCallback(() => {
    overrideAnswer(currentIndex);
    setLastCheckResult({ ...lastCheckResult, isCorrect: true, reason: 'Overridden' });
  }, [currentIndex, lastCheckResult, overrideAnswer]);

  const handleNext = useCallback(() => {
    if (currentIndex < questions.length - 1) {
      nextQuestion();
    } else {
      // All questions answered, complete the game
      completeGame();
    }
  }, [currentIndex, questions.length, nextQuestion, completeGame]);

  const handleSkip = useCallback(() => {
    // Stop TTS when skipping
    stopSpeaking();
    // Skip counts as wrong
    setUserAnswer(currentIndex, '');
    revealAnswer(currentIndex, false, '');
    setShowResult(true);
    setLastCheckResult({ isCorrect: false, confidence: 0, reason: 'Skipped' });
  }, [currentIndex, setUserAnswer, revealAnswer]);

  const handleBackToMenu = () => {
    navigate('/menu');
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="daily-page">
        <div className="daily-loading">
          <div className="spinner" />
          <p>Loading today's challenge...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="daily-page">
        <div className="daily-error">
          <h2>Oops!</h2>
          <p>{error}</p>
          <button onClick={() => window.location.reload()} className="btn-primary">
            Try Again
          </button>
          <button onClick={handleBackToMenu} className="btn-secondary">
            Back to Menu
          </button>
        </div>
      </div>
    );
  }

  // Already played today - show results
  if (hasPlayedToday() || isComplete) {
    return (
      <div className="daily-page">
        <DailyResults onBackToMenu={handleBackToMenu} verifyCode={verifyCode} />
      </div>
    );
  }

  // No questions loaded yet or invalid question data
  if (!currentQuestion || !currentQuestion.clue) {
    return (
      <div className="daily-page">
        <div className="daily-loading">
          <div className="spinner" />
          <p>Preparing questions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="daily-page">
      {/* Header */}
      <header className="daily-header">
        <button onClick={handleBackToMenu} className="btn-back">
          &larr; Menu
        </button>
        <div className="daily-title">
          <h1>Daily Jeoparody</h1>
          <p className="daily-date">{formatDisplayDate(todayDate)}</p>
        </div>
        <div className="daily-stats-mini">
          <span className="streak-badge" title="Current streak">
            {stats.currentStreak > 0 ? `${stats.currentStreak} day streak` : ''}
          </span>
        </div>
      </header>

      {/* Progress Dots - visual only, no navigation */}
      <div className="progress-dots">
        {questions.map((_, index) => (
          <div
            key={index}
            className={`progress-dot ${
              index === currentIndex ? 'current' : ''
            } ${answers[index]?.revealed ? (answers[index]?.correct ? 'correct' : 'incorrect') : ''}`}
          >
            {index + 1}
          </div>
        ))}
      </div>

      {/* Question Card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          className="daily-question-card"
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -50 }}
          transition={{ duration: 0.3 }}
        >
          <div className="category-badge">
            {currentQuestion.category || 'CATEGORY'}
          </div>

          <div className="value-badge">
            ${currentQuestion.value || 200}
          </div>

          <div className="clue-text">
            {currentQuestion.clue || ''}
          </div>

          {!showResult ? (
            <form onSubmit={handleSubmit} className="answer-form">
              <input
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="What is..."
                className="answer-input"
                autoFocus
                autoComplete="off"
              />
              <div className="answer-actions">
                <button
                  type="submit"
                  className="btn-primary btn-submit"
                  disabled={!userInput.trim()}
                >
                  Submit
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-skip"
                  onClick={handleSkip}
                >
                  Skip
                </button>
              </div>
            </form>
          ) : (
            <motion.div
              className="result-display"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className={`result-badge ${currentAnswer?.correct ? 'correct' : 'incorrect'}`}>
                {currentAnswer?.correct ? 'Correct!' : 'Incorrect'}
              </div>

              {currentAnswer?.playerAnswer && (
                <p className="your-answer">
                  Your answer: <span>{currentAnswer.playerAnswer}</span>
                </p>
              )}

              <p className="correct-answer">
                Correct answer: <span>{currentQuestion.answer}</span>
              </p>

              {!currentAnswer?.correct && lastCheckResult && (
                <button
                  className="btn-override"
                  onClick={handleOverride}
                >
                  I was right!
                </button>
              )}

              <button
                className="btn-primary btn-next"
                onClick={handleNext}
              >
                {currentIndex < questions.length - 1 ? 'Next Question' : 'See Results'}
              </button>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Question counter */}
      <p className="question-counter">
        Question {currentIndex + 1} of {questions.length}
      </p>
    </div>
  );
}
