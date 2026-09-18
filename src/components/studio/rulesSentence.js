/**
 * The rules of a game, as one sentence.
 *
 * Kept out of the component so a screen can say what the game will be without
 * pulling in the switches that change it.
 */
const clock = (ms) => (ms ? `${ms / 1000}s clock` : 'no clock');

export function rulesSentence(settings) {
  const parts = [settings.enableDoubleJeopardy ? 'Two rounds' : 'One round'];
  if (settings.enableDailyDouble) parts.push('Daily Doubles');
  if (settings.enableFinalJeopardy) parts.push('Final Jeopardy');
  parts.push(clock(settings.questionTimeLimit));
  return `${parts.join(', ')}.`;
}
