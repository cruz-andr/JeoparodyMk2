import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../hooks';
import { useRoomStore, useSettingsStore } from '../stores';
import { useHostStore } from '../stores/hostStore';
import { socketClient } from '../services/socket/socketClient';
import { generateCategories, generateQuestions } from '../services/api/aiService';
import HostSettingsPanel from '../components/setup/HostSettingsPanel';
import GenreSelector from '../components/setup/GenreSelector';
import CategoryEditor from '../components/setup/CategoryEditor';
import QuestionEditor from '../components/setup/QuestionEditor';
import ImportQuestionsPanel from '../components/setup/ImportQuestionsPanel';
import './HostPage.css';

const POINT_VALUES = [200, 400, 600, 800, 1000];

export default function HostPage() {
  const navigate = useNavigate();
  const { isConnected } = useSocket();
  const {
    setupPhase,
    setSetupPhase,
    contentSubPhase,
    setContentSubPhase,
    answerMode,
    contentSource,
    setContentSource,
    genre,
    setGenre,
    categories,
    setCategories,
    setQuestionsFromAI,
    initializeEmptyQuestions,
    getQuestionsForServer,
    reset: resetHost,
    isGenerating,
    setIsGenerating,
  } = useHostStore();

  const settings = useSettingsStore();
  const [error, setError] = useState(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  // Reset host store on mount
  useEffect(() => {
    resetHost();
  }, []);

  // Handle settings complete
  const handleSettingsComplete = () => {
    setSetupPhase('content');
    setContentSubPhase(null); // Show source selection
  };

  // Handle content source selection
  const handleContentSourceSelect = (source) => {
    setContentSource(source);
    if (source === 'ai') {
      setContentSubPhase('genreSelect');
    } else {
      setContentSubPhase('import');
    }
  };

  // Handle genre submission (AI path)
  const handleGenreSubmit = async (selectedGenre) => {
    setGenre(selectedGenre);
    setError(null);
    setIsGenerating(true, 'categories');

    try {
      const generatedCategories = await generateCategories(selectedGenre);
      setCategories(generatedCategories);
      setContentSubPhase('categoryEdit');
    } catch (err) {
      setError(err.message || 'Failed to generate categories');
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle category editing complete
  const handleCategoriesComplete = async () => {
    setError(null);
    setIsGenerating(true, 'questions');

    try {
      const questionsData = await generateQuestions(categories, POINT_VALUES, 1);
      setQuestionsFromAI(questionsData, categories);
      setContentSubPhase('questionEdit');
    } catch (err) {
      setError(err.message || 'Failed to generate questions');
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle category name change
  const handleCategoryEdit = (index, value) => {
    const newCategories = [...categories];
    newCategories[index] = value;
    setCategories(newCategories);
  };

  // Handle import complete
  const handleImportComplete = () => {
    setContentSubPhase('questionEdit');
  };

  // Handle question editing complete - create room
  const handleQuestionsComplete = async () => {
    setIsCreatingRoom(true);
    setError(null);

    try {
      // Create room on backend
      const { roomCode: newRoomCode } = await socketClient.createRoom('host', {
        maxPlayers: 30,
        answerMode: answerMode,
        questionTimeLimit: settings.questionTimeLimit,
        enableDoubleJeopardy: settings.enableDoubleJeopardy,
        enableDailyDouble: settings.enableDailyDouble,
        enableFinalJeopardy: settings.enableFinalJeopardy,
      });

      // Update room store
      useRoomStore.getState().setRoomCode(newRoomCode);
      useRoomStore.getState().setIsHost(true);
      useRoomStore.getState().setRoomType('host');
      useRoomStore.getState().updateSettings({
        answerMode: answerMode,
        maxPlayers: 30,
      });

      // Join the room as host
      const result = await socketClient.joinRoom(newRoomCode, 'Host', null);

      if (result.players) {
        useRoomStore.getState().setPlayers(result.players);
      }

      // Set questions on server
      const questionsData = getQuestionsForServer();
      socketClient.emit('host:set-custom-questions', {
        roomCode: newRoomCode,
        ...questionsData,
      });

      // Mark as fresh join
      sessionStorage.setItem('jeopardy_fresh_join', 'true');

      // Navigate to game page with questions in state
      navigate(`/game/${newRoomCode}`, {
        state: {
          hostModeQuestions: {
            categories: questionsData.categories,
            questions: questionsData.questions,
            answerMode: answerMode,
          }
        }
      });
    } catch (err) {
      setError(err.message || 'Failed to create room');
      setIsCreatingRoom(false);
    }
  };

  // Navigation helpers
  const handleBack = () => {
    if (setupPhase === 'settings') {
      navigate('/menu');
    } else if (setupPhase === 'content') {
      if (contentSubPhase === null) {
        setSetupPhase('settings');
      } else if (contentSubPhase === 'genreSelect' || contentSubPhase === 'import') {
        setContentSubPhase(null);
      } else if (contentSubPhase === 'categoryEdit') {
        setContentSubPhase('genreSelect');
      } else if (contentSubPhase === 'questionEdit') {
        if (contentSource === 'ai') {
          setContentSubPhase('categoryEdit');
        } else {
          setContentSubPhase('import');
        }
      }
    }
  };

  // Render progress indicator
  const renderProgress = () => {
    const steps = ['Settings', 'Content', 'Review'];
    const currentStep = setupPhase === 'settings' ? 0 : setupPhase === 'content' && contentSubPhase !== 'questionEdit' ? 1 : 2;

    return (
      <div className="progress-indicator">
        {steps.map((step, index) => (
          <div
            key={step}
            className={`progress-step ${index <= currentStep ? 'active' : ''} ${index < currentStep ? 'completed' : ''}`}
          >
            <span className="step-number">{index + 1}</span>
            <span className="step-label">{step}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="host-page">
      <header className="host-header">
        <h1>Host Mode</h1>
        <p className="host-subtitle">Create a custom game for your classroom or team</p>
        {renderProgress()}
      </header>

      <AnimatePresence mode="wait">
        {/* Settings Phase */}
        {setupPhase === 'settings' && (
          <motion.div
            key="settings"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="phase-container"
          >
            <HostSettingsPanel
              onNext={handleSettingsComplete}
              onBack={() => navigate('/menu')}
            />
          </motion.div>
        )}

        {/* Content Phase - Source Selection */}
        {setupPhase === 'content' && contentSubPhase === null && (
          <motion.div
            key="source-select"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="phase-container"
          >
            <div className="content-source-selection">
              <h2>How would you like to create questions?</h2>
              <p className="source-subtitle">Choose a method to add your game content</p>

              <div className="source-options">
                <motion.button
                  className="source-card"
                  onClick={() => handleContentSourceSelect('ai')}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span className="source-icon">🤖</span>
                  <span className="source-label">AI-Assisted</span>
                  <span className="source-desc">
                    Enter a topic and let AI generate categories and questions.
                    You can edit everything before starting.
                  </span>
                </motion.button>

                <motion.button
                  className="source-card"
                  onClick={() => handleContentSourceSelect('import')}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span className="source-icon">📄</span>
                  <span className="source-label">Import from File</span>
                  <span className="source-desc">
                    Upload a JSON file with your pre-made categories and questions.
                  </span>
                </motion.button>
              </div>

              <button onClick={handleBack} className="btn-secondary btn-back">
                Back to Settings
              </button>
            </div>
          </motion.div>
        )}

        {/* Content Phase - AI: Genre Selection */}
        {setupPhase === 'content' && contentSubPhase === 'genreSelect' && (
          <motion.div
            key="genre-select"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="phase-container"
          >
            {isGenerating ? (
              <div className="generating-container">
                <div className="spinner" />
                <p>Generating categories...</p>
              </div>
            ) : (
              <GenreSelector
                onSubmit={handleGenreSubmit}
                error={error}
              />
            )}
            {!isGenerating && (
              <button onClick={handleBack} className="btn-secondary btn-back">
                Back
              </button>
            )}
          </motion.div>
        )}

        {/* Content Phase - AI: Category Editing */}
        {setupPhase === 'content' && contentSubPhase === 'categoryEdit' && (
          <motion.div
            key="category-edit"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="phase-container"
          >
            {isGenerating ? (
              <div className="generating-container">
                <div className="spinner" />
                <p>Generating questions...</p>
              </div>
            ) : (
              <CategoryEditor
                categories={categories}
                onEdit={handleCategoryEdit}
                onBack={handleBack}
                onNext={handleCategoriesComplete}
                error={error}
              />
            )}
          </motion.div>
        )}

        {/* Content Phase - Import */}
        {setupPhase === 'content' && contentSubPhase === 'import' && (
          <motion.div
            key="import"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="phase-container"
          >
            <ImportQuestionsPanel
              onBack={handleBack}
              onNext={handleImportComplete}
            />
          </motion.div>
        )}

        {/* Content Phase - Question Editing */}
        {setupPhase === 'content' && contentSubPhase === 'questionEdit' && (
          <motion.div
            key="question-edit"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="phase-container"
          >
            {isCreatingRoom ? (
              <div className="generating-container">
                <div className="spinner" />
                <p>Creating your game...</p>
              </div>
            ) : (
              <QuestionEditor
                onBack={handleBack}
                onNext={handleQuestionsComplete}
                answerMode={answerMode}
              />
            )}
            {error && (
              <motion.p
                className="error-message global-error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                {error}
              </motion.p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Connection Status */}
      {!isConnected && (
        <div className="connection-warning">
          Not connected to server. Please wait...
        </div>
      )}
    </div>
  );
}
