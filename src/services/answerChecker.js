// Client-side fuzzy matching for auto-grading answers
// Ported from server-side GameStateManager.js

// Normalize answer: remove Jeopardy prefixes, punctuation, etc.
function normalize(answer) {
  if (!answer) return '';

  return answer
    .toLowerCase()
    // Remove "What is", "Who is", "Where is", etc.
    .replace(/^(what|who|where|when|why|how)\s+(is|are|was|were|the)\s+/i, '')
    // Remove articles at the start
    .replace(/^(a|an|the)\s+/i, '')
    // Remove all non-alphanumeric except spaces
    .replace(/[^a-z0-9\s]/g, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
}

// Levenshtein distance for typo tolerance
function levenshteinDistance(a, b) {
  const matrix = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// Check if player's answer is correct
export function checkAnswer(playerAnswer, correctAnswer) {
  if (!playerAnswer || !correctAnswer) {
    return { isCorrect: false, confidence: 0, reason: 'Empty answer' };
  }

  const normalizedPlayer = normalize(playerAnswer);
  const normalizedCorrect = normalize(correctAnswer);

  // Handle empty normalized answers
  if (!normalizedPlayer || !normalizedCorrect) {
    return { isCorrect: false, confidence: 0, reason: 'Invalid answer format' };
  }

  // Exact match
  if (normalizedPlayer === normalizedCorrect) {
    return { isCorrect: true, confidence: 1.0, reason: 'Exact match' };
  }

  // Check if one contains the other (for partial matches)
  if (normalizedCorrect.includes(normalizedPlayer) && normalizedPlayer.length >= 3) {
    // Player's answer is contained in correct answer
    const ratio = normalizedPlayer.length / normalizedCorrect.length;
    if (ratio >= 0.5) {
      return { isCorrect: true, confidence: 0.85, reason: 'Partial match (contained)' };
    }
  }

  if (normalizedPlayer.includes(normalizedCorrect) && normalizedCorrect.length >= 3) {
    // Correct answer is contained in player's answer
    return { isCorrect: true, confidence: 0.8, reason: 'Partial match (includes)' };
  }

  // Split into words and check for key word matches
  const playerWords = normalizedPlayer.split(' ').filter(w => w.length > 2);
  const correctWords = normalizedCorrect.split(' ').filter(w => w.length > 2);

  if (correctWords.length > 0) {
    const matchedWords = playerWords.filter(pw =>
      correctWords.some(cw => cw === pw || levenshteinDistance(cw, pw) <= 1)
    );

    // If most key words match, consider it correct
    const matchRatio = matchedWords.length / correctWords.length;
    if (matchRatio >= 0.75 && matchedWords.length >= 1) {
      return { isCorrect: true, confidence: 0.75, reason: 'Key words match' };
    }
  }

  // Fuzzy match using Levenshtein distance
  const distance = levenshteinDistance(normalizedPlayer, normalizedCorrect);
  const maxLen = Math.max(normalizedPlayer.length, normalizedCorrect.length);
  const similarity = maxLen > 0 ? 1 - (distance / maxLen) : 0;

  // Accept if 80% similar (slightly more lenient than server)
  if (similarity >= 0.80) {
    return { isCorrect: true, confidence: similarity, reason: 'Fuzzy match' };
  }

  // For short answers (like single words), be more lenient
  if (normalizedCorrect.length <= 8 && distance <= 2) {
    return { isCorrect: true, confidence: 0.7, reason: 'Close match (short answer)' };
  }

  return { isCorrect: false, confidence: similarity, reason: 'No match found' };
}

// Format confidence as percentage
export function formatConfidence(confidence) {
  return `${Math.round(confidence * 100)}%`;
}
