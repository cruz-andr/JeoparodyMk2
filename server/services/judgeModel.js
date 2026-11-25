/**
 * Which model the answer judge asks, and how.
 *
 *   JUDGE_PROVIDER  groq | gemini | off. Unset: groq when GROQ_API_KEY is
 *                   set, else off. Gemini only when asked for by name: its
 *                   key is the board generator's, and a key that is out of
 *                   credit would fail every doubtful answer for nothing.
 *   JUDGE_MODEL     the provider's model id. Defaults below.
 *
 * Groq's gpt-oss-120b won scripts/judge-bench (Nov 2026): 98% on the exam,
 * the one miss harmless, every reply readable, about half a second per clue
 * and never over 0.7s, on Groq's free tier. Re-run the bench before changing
 * it.
 *
 * Off under NODE_ENV=test: nothing a test does should reach another site.
 */
import { judgeItems, judgePrompt, verdictsFrom } from './judgePrompt.js';
import * as gemini from './gemini.js';

export const DEFAULT_MODELS = {
  groq: 'openai/gpt-oss-120b',
  gemini: 'gemini-3.1-flash-lite',
};

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** One batch to Groq: a boolean per item, or a throw the judge turns into "no opinion". */
export async function askGroq(items, { apiKey, model, timeoutMs }) {
  const asked = judgeItems(items);
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      /* gpt-oss thinks before it answers. A little is all a judgment this
         small needs; more made it slower and, on the bench, less accurate. */
      ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
      messages: [{ role: 'user', content: judgePrompt(asked) }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`groq ${res.status}: ${data?.error?.message ?? 'no reason given'}`);
  const verdicts = verdictsFrom(data?.choices?.[0]?.message?.content ?? '', asked.length);
  if (!verdicts) throw new Error('groq: no verdicts in the reply');
  return verdicts;
}

/** Which provider and model the environment asks for, or null for none. */
export function judgeSetup(env = process.env) {
  if (env.NODE_ENV === 'test') return null;
  const named = String(env.JUDGE_PROVIDER ?? '').trim().toLowerCase();
  if (named === 'off') return null;
  const provider = named || (env.GROQ_API_KEY ? 'groq' : '');
  if (!DEFAULT_MODELS[provider]) return null;
  return { provider, model: String(env.JUDGE_MODEL ?? '').trim() || DEFAULT_MODELS[provider] };
}

/**
 * The judge's model as a function of a batch, or null for none. The setup
 * and the key are read on each call, so a key added later counts without a
 * restart; a provider whose key is missing resolves to "no opinion" at once.
 */
export function modelFromEnv(env = process.env, { timeoutMs }) {
  if (!judgeSetup(env)) return null;
  return async (items) => {
    const setup = judgeSetup(env);
    if (!setup) return null;
    if (setup.provider === 'groq') {
      if (!env.GROQ_API_KEY) return null;
      return askGroq(items, { apiKey: env.GROQ_API_KEY, model: setup.model, timeoutMs });
    }
    if (!gemini.isConfigured()) return null;
    return gemini.judgeResponses(items, { model: setup.model, timeoutMs });
  };
}
