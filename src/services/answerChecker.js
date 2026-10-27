/* The daily pages grade a typed response with the same matcher the server
   uses, from server/shared. This file used to hold a hand-ported copy of the
   server's, and the two drifted: an answer could be right on The Board and
   wrong in quickplay. */
import { gradeAnswer } from '@shared/answerMatch.js';

// Check if player's answer is correct
export function checkAnswer(playerAnswer, correctAnswer) {
  return gradeAnswer(playerAnswer, correctAnswer);
}

// Format confidence as percentage
export function formatConfidence(confidence) {
  return `${Math.round(confidence * 100)}%`;
}
