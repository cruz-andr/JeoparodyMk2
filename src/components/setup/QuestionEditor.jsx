import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHostStore } from '../../stores/hostStore';
import { generateMCOptions } from '../../services/api/aiService';
import MediaAttachment from './MediaAttachment';
import './QuestionEditor.css';

const POINT_VALUES = [200, 400, 600, 800, 1000];

/**
 * Four optional props were added so the board editor could reuse this rather
 * than fork it. They all default to what host mode already did, so host mode
 * is untouched.
 *
 * `requireComplete` is the one that matters: host mode is about to start a
 * game, so it refuses to move on with holes in the board. A draft is allowed
 * to have holes, and blocking Done would be blocking someone from leaving
 * their own unfinished work.
 */
export default function QuestionEditor({
  onBack,
  onNext,
  answerMode = 'verbal',
  heading = 'Edit Questions',
  subheading = 'Review and customize all questions before starting the game',
  requireComplete = true,
  nextLabel = 'Create Game',
  backLabel = 'Back',
}) {
  const { categories, questions, updateCategory, updateQuestion, validateContent, validationErrors } = useHostStore();
  const [activeTab, setActiveTab] = useState(0);
  const [showValidation, setShowValidation] = useState(false);
  const [generatingOptions, setGeneratingOptions] = useState({}); // Track which questions are generating

  const isMCMode = answerMode === 'multiple_choice';

  const handleGenerateMCOptions = async (pointIndex) => {
    const question = questions[activeTab]?.[pointIndex];
    if (!question?.question || !question?.answer) {
      alert('Please enter both the clue and correct answer first.');
      return;
    }

    const key = `${activeTab}-${pointIndex}`;
    setGeneratingOptions(prev => ({ ...prev, [key]: true }));

    try {
      const result = await generateMCOptions(
        question.question,
        categories[activeTab] || 'General',
        question.answer
      );
      updateQuestion(activeTab, pointIndex, { options: result.options });
    } catch (error) {
      console.error('Failed to generate MC options:', error);
      alert('Failed to generate options. Please try again.');
    } finally {
      setGeneratingOptions(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleNext = () => {
    if (!requireComplete) {
      onNext();
      return;
    }
    const isValid = validateContent();
    if (isValid) {
      onNext();
    } else {
      setShowValidation(true);
    }
  };

  const handleQuestionChange = (pointIndex, field, value) => {
    updateQuestion(activeTab, pointIndex, { [field]: value });
  };

  const handleOptionChange = (pointIndex, optionIndex, value) => {
    const currentOptions = questions[activeTab]?.[pointIndex]?.options || ['', '', '', ''];
    const newOptions = [...currentOptions];
    newOptions[optionIndex] = value;
    updateQuestion(activeTab, pointIndex, { options: newOptions });
  };

  const categoryQuestions = questions[activeTab] || [];

  return (
    <motion.div
      className="question-editor"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <h2>{heading}</h2>
      <p className="editor-subtitle">{subheading}</p>

      {/* Category Tabs */}
      <div className="category-tabs">
        {categories.map((cat, index) => (
          <button
            key={index}
            className={`category-tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            <span className="tab-number">{index + 1}</span>
            <span className="tab-name">{cat || `Category ${index + 1}`}</span>
          </button>
        ))}
      </div>

      {/* Category Name Editor */}
      <div className="category-name-section">
        <label className="field-label">Category Name</label>
        <input
          type="text"
          value={categories[activeTab] || ''}
          onChange={(e) => updateCategory(activeTab, e.target.value)}
          className="category-name-input"
          placeholder="Enter category name"
        />
      </div>

      {/* Questions List */}
      <div className="questions-list">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {POINT_VALUES.map((points, pointIndex) => {
              const question = categoryQuestions[pointIndex] || {};
              return (
                <div key={pointIndex} className="question-card">
                  <div className="question-header">
                    <span className="point-value">${points}</span>
                  </div>

                  <div className="question-fields">
                    <div className="field-group">
                      <label className="field-label">Clue (shown to players)</label>
                      <textarea
                        value={question.answer || ''}
                        onChange={(e) => handleQuestionChange(pointIndex, 'answer', e.target.value)}
                        placeholder="Enter the clue that players will see..."
                        rows={2}
                        className="question-textarea"
                      />
                    </div>

                    <div className="field-group">
                      <label className="field-label">
                        Correct Answer {!isMCMode && '(What is/Who is...)'}
                      </label>
                      <input
                        type="text"
                        value={question.question || ''}
                        onChange={(e) => handleQuestionChange(pointIndex, 'question', e.target.value)}
                        placeholder={isMCMode ? 'Enter the correct answer' : 'What is...? / Who is...?'}
                        className="question-input"
                      />
                    </div>

                    {/* Media Attachment */}
                    <MediaAttachment
                      mediaType={question.mediaType || null}
                      mediaData={question.mediaData || null}
                      youtubeStart={question.youtubeStart ?? null}
                      youtubeEnd={question.youtubeEnd ?? null}
                      audioOnly={question.audioOnly || false}
                      altText={question.altText || null}
                      onChange={(updates) => updateQuestion(activeTab, pointIndex, updates)}
                    />

                    {/* Multiple Choice Options */}
                    {isMCMode && (
                      <div className="field-group mc-options">
                        <div className="mc-options-header">
                          <label className="field-label">Answer Options (first one is correct)</label>
                          <button
                            type="button"
                            className={`btn-generate-mc ${generatingOptions[`${activeTab}-${pointIndex}`] ? 'loading' : ''}`}
                            onClick={() => handleGenerateMCOptions(pointIndex)}
                            disabled={generatingOptions[`${activeTab}-${pointIndex}`]}
                          >
                            {generatingOptions[`${activeTab}-${pointIndex}`] ? 'Generating...' : 'AI Generate'}
                          </button>
                        </div>
                        <div className="options-grid">
                          {['A', 'B', 'C', 'D'].map((letter, optionIndex) => (
                            <div key={letter} className={`option-input-wrapper ${optionIndex === 0 ? 'correct' : ''}`}>
                              <span className="option-letter">{letter}</span>
                              <input
                                type="text"
                                value={question.options?.[optionIndex] || ''}
                                onChange={(e) => handleOptionChange(pointIndex, optionIndex, e.target.value)}
                                placeholder={optionIndex === 0 ? 'Correct answer' : `Option ${letter}`}
                                className="option-input"
                              />
                              {optionIndex === 0 && <span className="correct-badge">Correct</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Validation Errors */}
      {showValidation && validationErrors.length > 0 && (
        <motion.div
          className="validation-errors"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h4>Please fix the following issues:</h4>
          <ul>
            {validationErrors.slice(0, 5).map((error, index) => (
              <li key={index}>{error}</li>
            ))}
            {validationErrors.length > 5 && (
              <li className="more-errors">...and {validationErrors.length - 5} more</li>
            )}
          </ul>
        </motion.div>
      )}

      {/* Actions */}
      <div className="editor-actions">
        <button onClick={onBack} className="btn-secondary">
          {backLabel}
        </button>
        <button onClick={handleNext} className="btn-primary">
          {nextLabel}
        </button>
      </div>
    </motion.div>
  );
}
