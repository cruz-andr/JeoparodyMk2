import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHostStore } from '../../stores/hostStore';
import { parseQuestionFile, downloadSampleTemplate } from '../../services/questionImport';
import './ImportQuestionsPanel.css';

export default function ImportQuestionsPanel({ onBack, onNext }) {
  const { setImportedData, setImportError, importedData, importError } = useHostStore();
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    await processFile(file);
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (file) {
      await processFile(file);
    }
  };

  const processFile = async (file) => {
    setIsLoading(true);
    setValidationErrors([]);
    setImportError(null);

    const result = await parseQuestionFile(file);

    setIsLoading(false);

    if (result.valid) {
      setImportedData(result.data);
      setValidationErrors([]);
    } else {
      setValidationErrors(result.errors);
      setImportError(result.errors[0]);
      setImportedData(null);
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleClearImport = () => {
    setImportedData(null);
    setValidationErrors([]);
    setImportError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleNext = () => {
    if (importedData) {
      onNext();
    }
  };

  return (
    <motion.div
      className="import-panel"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <h2>Import Questions</h2>
      <p className="import-subtitle">
        Upload a JSON file with your custom categories and questions
      </p>

      {/* Drop Zone */}
      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''} ${importedData ? 'has-file' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={!importedData ? handleBrowseClick : undefined}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileSelect}
          className="file-input"
        />

        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div
              key="loading"
              className="drop-content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="loading-spinner" />
              <p>Processing file...</p>
            </motion.div>
          ) : importedData ? (
            <motion.div
              key="success"
              className="drop-content success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              <span className="success-icon">✓</span>
              <p className="success-text">File imported successfully!</p>
              <p className="file-summary">
                {importedData.categories.length} categories,{' '}
                {importedData.categories.reduce((acc, cat) => acc + cat.questions.length, 0)} questions
              </p>
              <button onClick={handleClearImport} className="btn-clear">
                Remove and upload different file
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              className="drop-content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <span className="upload-icon">📄</span>
              <p className="drop-text">
                {isDragging ? 'Drop your file here' : 'Drag & drop your JSON file here'}
              </p>
              <p className="drop-subtext">or click to browse</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <motion.div
          className="import-errors"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h4>File validation failed:</h4>
          <ul>
            {validationErrors.slice(0, 8).map((error, index) => (
              <li key={index}>{error}</li>
            ))}
            {validationErrors.length > 8 && (
              <li className="more-errors">...and {validationErrors.length - 8} more issues</li>
            )}
          </ul>
        </motion.div>
      )}

      {/* Preview */}
      {importedData && (
        <motion.div
          className="import-preview"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h3>Preview</h3>
          <div className="categories-preview">
            {importedData.categories.map((cat, index) => (
              <div key={index} className="category-preview-card">
                <span className="category-name">{cat.name}</span>
                <span className="question-count">{cat.questions.length} questions</span>
              </div>
            ))}
          </div>
          {importedData.finalJeopardy && (
            <div className="final-jeopardy-preview">
              <span className="fj-label">Final Jeopardy:</span>
              <span className="fj-category">{importedData.finalJeopardy.category}</span>
            </div>
          )}
        </motion.div>
      )}

      {/* Template Download */}
      <div className="template-section">
        <p>Need a template?</p>
        <button onClick={downloadSampleTemplate} className="btn-template">
          Download Sample Template
        </button>
      </div>

      {/* Actions */}
      <div className="import-actions">
        <button onClick={onBack} className="btn-secondary">
          Back
        </button>
        <button
          onClick={handleNext}
          className="btn-primary"
          disabled={!importedData}
        >
          Next: Review Questions
        </button>
      </div>
    </motion.div>
  );
}
