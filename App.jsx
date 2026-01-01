// App.jsx
import { useState } from 'react';
import './App.css';
import * as aiService from './api/aiService';

function App() {
  const [genre, setGenre] = useState('');
  const [categories, setCategories] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [currentView, setCurrentView] = useState('genreSelect'); // genreSelect, categoryEdit, game
  const [loading, setLoading] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [error, setError] = useState(null);

  const pointValues = [200, 400, 600, 800, 1000];

  const handleGenerateCategories = async () => {
    setLoading(true);
    setError(null);

    try {
      const generatedCategories = await aiService.generateCategories(genre);
      setCategories(generatedCategories);
      setCurrentView('categoryEdit');
    } catch (err) {
      console.error("Error generating categories:", err);
      setError(err.message || "Failed to generate categories. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateQuestions = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await aiService.generateQuestions(categories, pointValues);

      // Transform AI response into our grid format
      const questionGrid = result.categories.map(cat => {
        return cat.questions.map(q => ({
          category: cat.name,
          points: q.points,
          answer: q.answer,
          question: q.question,
          revealed: false
        }));
      });

      setQuestions(questionGrid);
      setCurrentView('game');
    } catch (err) {
      console.error("Error generating questions:", err);
      setError(err.message || "Failed to generate questions. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryEdit = (index, newValue) => {
    const updatedCategories = [...categories];
    updatedCategories[index] = newValue;
    setCategories(updatedCategories);
  };

  const handleQuestionClick = (categoryIndex, questionIndex) => {
    const question = questions[categoryIndex][questionIndex];
    if (!question.revealed) {
      // Mark as revealed
      const newQuestions = [...questions];
      newQuestions[categoryIndex][questionIndex].revealed = true;
      setQuestions(newQuestions);
      
      // Set as current question
      setCurrentQuestion({...question, categoryIndex, questionIndex});
      setShowAnswer(false);
    }
  };

  const closeQuestion = () => {
    setCurrentQuestion(null);
    setShowAnswer(false);
  };

  const resetGame = () => {
    setGenre('');
    setCategories([]);
    setQuestions([]);
    setCurrentView('genreSelect');
    setCurrentQuestion(null);
    setShowAnswer(false);
  };

  return (
    <div className="app">
      <header>
        <h1>AI Jeopardy!</h1>
      </header>

      {loading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p>The AI is thinking...</p>
        </div>
      )}

      {currentView === 'genreSelect' && (
        <div className="genre-select">
          <h2>Choose a Genre</h2>
          <input 
            type="text" 
            value={genre} 
            onChange={(e) => setGenre(e.target.value)}
            placeholder="Enter a genre (e.g., Science, Movies, History)"
          />
          <button
            onClick={handleGenerateCategories}
            disabled={!genre.trim() || loading}
          >
            Generate Categories
          </button>
          {error && <p className="error-message">{error}</p>}
        </div>
      )}

      {currentView === 'categoryEdit' && (
        <div className="category-edit">
          <h2>Edit Categories (Optional)</h2>
          <div className="categories-list">
            {categories.map((category, index) => (
              <div key={index} className="category-item">
                <input
                  type="text"
                  value={category}
                  onChange={(e) => handleCategoryEdit(index, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="button-row">
            <button onClick={() => setCurrentView('genreSelect')}>Back</button>
            <button onClick={handleGenerateQuestions}>Next: Generate Questions</button>
          </div>
          {error && <p className="error-message">{error}</p>}
        </div>
      )}

      {currentView === 'game' && (
        <div className="game-board">
          <div className="categories-row">
            {categories.map((category, index) => (
              <div key={index} className="category-header">
                {category}
              </div>
            ))}
          </div>
          
          <div className="questions-grid">
            {pointValues.map((points, pointIndex) => (
              <div key={pointIndex} className="question-row">
                {categories.map((_, categoryIndex) => {
                  const question = questions[categoryIndex][pointIndex];
                  return (
                    <div 
                      key={categoryIndex} 
                      className={`question-cell ${question.revealed ? 'revealed' : ''}`}
                      onClick={() => handleQuestionClick(categoryIndex, pointIndex)}
                    >
                      {question.revealed ? '' : `$${points}`}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          
          <button className="reset-button" onClick={resetGame}>
            New Game
          </button>
        </div>
      )}

      {currentQuestion && (
        <div className="question-modal">
          <div className="question-modal-content">
            <div className="question-details">
              <h3>{currentQuestion.category} - ${currentQuestion.points}</h3>
              <p className="answer">{currentQuestion.answer}</p>
              
              {showAnswer ? (
                <div className="correct-question">
                  <p>Correct question:</p>
                  <p className="question-text">{currentQuestion.question}</p>
                </div>
              ) : (
                <button onClick={() => setShowAnswer(true)}>
                  Show Correct Question
                </button>
              )}
            </div>
            <button className="close-button" onClick={closeQuestion}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;