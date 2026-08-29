/**
 * Compresses an image file using Canvas API.
 * Resizes to max dimension and converts to WebP.
 *
 * @param {File} file - The image file to compress
 * @param {number} maxDimension - Max width or height in pixels (default 800)
 * @param {number} quality - WebP quality 0-1 (default 0.7)
 * @returns {Promise<string>} Compressed base64 data URL
 */
export function compressImage(file, maxDimension = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Invalid image file'));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      reject(new Error('Image must be under 5MB'));
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // Scale down if either dimension exceeds max
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round(height * (maxDimension / width));
          width = maxDimension;
        } else {
          width = Math.round(width * (maxDimension / height));
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Try WebP first, fall back to JPEG if browser doesn't support WebP
      let dataUrl = canvas.toDataURL('image/webp', quality);
      if (!dataUrl.startsWith('data:image/webp')) {
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }

      resolve(dataUrl);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

/**
 * Extracts a YouTube video ID from various URL formats.
 * Supports youtube.com/watch?v=, youtu.be/, youtube.com/embed/, etc.
 *
 * @param {string} url - YouTube URL
 * @returns {string|null} Video ID or null if invalid
 */
export function extractYouTubeId(url) {
  if (!url) return null;
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

/**
 * Parses a MM:SS or SS time string into total seconds.
 *
 * @param {string} timeStr - Time string like "1:30" or "90"
 * @returns {number|null} Total seconds, or null if invalid
 */
export function parseTimeToSeconds(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const trimmed = timeStr.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(':');
  if (parts.length === 1) {
    const sec = parseInt(parts[0], 10);
    return isNaN(sec) || sec < 0 ? null : sec;
  }
  if (parts.length === 2) {
    const min = parseInt(parts[0], 10);
    const sec = parseInt(parts[1], 10);
    if (isNaN(min) || isNaN(sec) || min < 0 || sec < 0 || sec >= 60) return null;
    return min * 60 + sec;
  }
  return null;
}

/**
 * Formats seconds into MM:SS string.
 *
 * @param {number} totalSeconds
 * @returns {string} Formatted time string
 */
export function formatSecondsToTime(totalSeconds) {
  if (totalSeconds == null || totalSeconds < 0) return '';
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}
