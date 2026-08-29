import { useState, useRef, useCallback } from 'react';
import { compressImage, extractYouTubeId, parseTimeToSeconds, formatSecondsToTime } from '../../utils/imageCompressor';
import YouTubePlayer from '../media/YouTubePlayer';
import './MediaAttachment.css';

export default function MediaAttachment({
  mediaType,
  mediaData,
  youtubeStart,
  youtubeEnd,
  audioOnly,
  altText,
  onChange,
}) {
  const [dragOver, setDragOver] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [ytUrl, setYtUrl] = useState('');
  const [startStr, setStartStr] = useState(formatSecondsToTime(youtubeStart) || '');
  const [endStr, setEndStr] = useState(formatSecondsToTime(youtubeEnd) || '');
  const fileInputRef = useRef(null);

  const handleTypeChange = useCallback((type) => {
    setError(null);
    setShowPreview(false);
    if (type === null) {
      onChange({
        mediaType: null,
        mediaData: null,
        youtubeStart: null,
        youtubeEnd: null,
        audioOnly: false,
        altText: null,
      });
    } else {
      onChange({
        mediaType: type,
        mediaData: type === mediaType ? mediaData : null,
        youtubeStart: type === 'youtube' ? youtubeStart : null,
        youtubeEnd: type === 'youtube' ? youtubeEnd : null,
        audioOnly: type === 'youtube' ? (audioOnly || false) : false,
        altText,
      });
    }
  }, [mediaType, mediaData, youtubeStart, youtubeEnd, audioOnly, altText, onChange]);

  const handleImageFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5MB');
      return;
    }

    setCompressing(true);
    setError(null);
    try {
      const compressed = await compressImage(file, 800, 0.7);
      onChange({ mediaType: 'image', mediaData: compressed });
    } catch (err) {
      setError(err.message || 'Failed to compress image');
    } finally {
      setCompressing(false);
    }
  }, [onChange]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  }, [handleImageFile]);

  const handleYouTubeUrl = useCallback((url) => {
    setYtUrl(url);
    const id = extractYouTubeId(url);
    if (id) {
      setError(null);
      onChange({ mediaType: 'youtube', mediaData: id });
    } else if (url.trim()) {
      setError('Invalid YouTube URL');
    }
  }, [onChange]);

  const handleStartTime = useCallback((str) => {
    setStartStr(str);
    const seconds = parseTimeToSeconds(str);
    onChange({ youtubeStart: seconds });
  }, [onChange]);

  const handleEndTime = useCallback((str) => {
    setEndStr(str);
    const seconds = parseTimeToSeconds(str);
    if (seconds != null && youtubeStart != null && seconds <= youtubeStart) {
      setError('End time must be after start time');
    } else {
      setError(null);
    }
    onChange({ youtubeEnd: seconds });
  }, [onChange, youtubeStart]);

  return (
    <div className="media-attachment">
      <label className="media-label">Media Attachment</label>

      {/* Type selector */}
      <div className="media-type-selector">
        <button
          type="button"
          className={`media-type-btn ${mediaType === null ? 'active' : ''}`}
          onClick={() => handleTypeChange(null)}
        >
          None
        </button>
        <button
          type="button"
          className={`media-type-btn ${mediaType === 'image' ? 'active' : ''}`}
          onClick={() => handleTypeChange('image')}
        >
          Image
        </button>
        <button
          type="button"
          className={`media-type-btn ${mediaType === 'youtube' ? 'active' : ''}`}
          onClick={() => handleTypeChange('youtube')}
        >
          YouTube
        </button>
      </div>

      {/* Image upload */}
      {mediaType === 'image' && (
        <div className="media-image-section">
          {!mediaData ? (
            <div
              className={`media-dropzone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {compressing ? (
                <span className="media-compress-text">Compressing...</span>
              ) : (
                <>
                  <span className="media-drop-text">
                    Drop image here or click to browse
                  </span>
                  <span className="media-drop-hint">Max 5MB, auto-compressed to WebP</span>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => handleImageFile(e.target.files[0])}
              />
            </div>
          ) : (
            <div className="media-image-preview">
              <img src={mediaData} alt="Clue preview" className="media-preview-img" />
              <button
                type="button"
                className="media-remove-btn"
                onClick={() => onChange({ mediaType: 'image', mediaData: null })}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      )}

      {/* YouTube input */}
      {mediaType === 'youtube' && (
        <div className="media-youtube-section">
          <input
            type="text"
            className="media-input"
            placeholder="Paste YouTube URL..."
            value={ytUrl}
            onChange={(e) => handleYouTubeUrl(e.target.value)}
          />

          {mediaData && (
            <>
              <div className="media-time-row">
                <div className="media-time-field">
                  <label>Start (MM:SS)</label>
                  <input
                    type="text"
                    className="media-input media-time-input"
                    placeholder="0:00"
                    value={startStr}
                    onChange={(e) => handleStartTime(e.target.value)}
                  />
                </div>
                <div className="media-time-field">
                  <label>End (MM:SS)</label>
                  <input
                    type="text"
                    className={`media-input media-time-input ${
                      youtubeEnd != null && youtubeStart != null && youtubeEnd <= youtubeStart
                        ? 'input-error'
                        : ''
                    }`}
                    placeholder="Leave blank for full"
                    value={endStr}
                    onChange={(e) => handleEndTime(e.target.value)}
                  />
                </div>
              </div>

              <label className="media-checkbox">
                <input
                  type="checkbox"
                  checked={audioOnly || false}
                  onChange={(e) => onChange({ audioOnly: e.target.checked })}
                />
                Play Audio Only (hide video)
              </label>

              <button
                type="button"
                className="media-preview-btn"
                onClick={() => setShowPreview(!showPreview)}
              >
                {showPreview ? 'Hide Preview' : 'Preview Clip'}
              </button>

              {showPreview && (
                <div className="media-yt-preview">
                  <YouTubePlayer
                    videoId={mediaData}
                    startTime={youtubeStart || 0}
                    endTime={youtubeEnd}
                    autoPlay={false}
                    audioOnly={audioOnly || false}
                    height={200}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Alt text */}
      {mediaType && (
        <input
          type="text"
          className="media-input media-alt-input"
          placeholder="Alt text / host notes (optional)"
          value={altText || ''}
          onChange={(e) => onChange({ altText: e.target.value || null })}
        />
      )}

      {error && <span className="media-error">{error}</span>}
    </div>
  );
}
