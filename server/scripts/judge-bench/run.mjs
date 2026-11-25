/**
 * Which model should be the answer judge? Asks each candidate the judge's
 * own prompt (services/judgePrompt.js) about every case in cases.js and
 * reports how often it was right, how often it handed out points nobody
 * earned, and how fast it answered.
 *
 *   node server/scripts/judge-bench/run.mjs                 every provider with a key
 *   node server/scripts/judge-bench/run.mjs --only gemma    model ids containing "gemma"
 *   node server/scripts/judge-bench/run.mjs --list          the candidates, and stop
 *
 * Keys, from the environment or a git-ignored file passed with
 * `node --env-file=server/.env.bench ...` (all of these have a free tier):
 *   GEMINI_FREE_API_KEY  an AI Studio key in a project with NO billing on it.
 *                        A prepay project's key is refused for every model,
 *                        Gemma included, once its credit is gone.
 *   GROQ_API_KEY         console.groq.com
 *   OPENROUTER_API_KEY   openrouter.ai; free models allow 50 calls a day
 *                        (1,000 once $10 of credit has ever been bought), so
 *                        use --only to spread a run over days.
 *   MISTRAL_API_KEY      console.mistral.ai, the free Experiment plan
 *
 * Each model gets the cases in batches of BATCH (accuracy) and then
 * SINGLES one-clue calls (speed: that is what a reveal waits on). Calls to a
 * provider are spaced to stay under its free per-minute limit, so a full run
 * takes a while.
 */
import { CASES } from './cases.js';
import { judgeItems, judgePrompt, verdictsFrom } from '../../services/judgePrompt.js';
import { gradeAnswer } from '../../shared/answerMatch.js';

const BATCH = 6;
const SINGLES = 6;
/* How long production gives the model (services/gemini.js JUDGE_TIMEOUT_MS). */
const PRODUCTION_BUDGET_MS = 2500;
/* How long the bench waits, so a slow model is measured rather than cut off. */
const CALL_TIMEOUT_MS = 20000;

// ------------------------------------------------------------ providers

async function timed(fn) {
  const started = performance.now();
  try {
    const text = await fn();
    return { ms: performance.now() - started, text };
  } catch (err) {
    return { ms: performance.now() - started, error: err.message };
  }
}

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${data?.error?.message ?? JSON.stringify(data).slice(0, 160)}`);
  return data;
}

function gemini(model, { json = true, thinking } = {}) {
  const key = process.env.GEMINI_FREE_API_KEY;
  return {
    provider: 'gemini', model: thinking ? `${model} (thinking ${thinking})` : model, key, gapMs: 4200,
    ask: async (prompt) => {
      const generationConfig = { temperature: 0 };
      if (json) generationConfig.responseMimeType = 'application/json';
      if (thinking) generationConfig.thinkingConfig = { thinkingLevel: thinking };
      const data = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { 'x-goog-api-key': key },
        { contents: [{ parts: [{ text: prompt }] }], generationConfig },
      );
      return (data?.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
    },
  };
}

function openAI(provider, baseUrl, keyName, gapMs, model, extra = {}) {
  const key = process.env[keyName];
  return {
    provider, model, key, gapMs,
    ask: async (prompt) => {
      const data = await postJson(`${baseUrl}/chat/completions`, { Authorization: `Bearer ${key}` }, {
        model, temperature: 0, messages: [{ role: 'user', content: prompt }], ...extra,
      });
      return data?.choices?.[0]?.message?.content ?? '';
    },
  };
}
const groq = (model, extra = {}) => ({
  ...openAI('groq', 'https://api.groq.com/openai/v1', 'GROQ_API_KEY', 2200, model, extra),
  ...(extra.reasoning_effort ? { label: `${model} (${extra.reasoning_effort})` } : {}),
});
const openrouter = (model, extra) => openAI('openrouter', 'https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY', 3300, model, extra);
const mistral = (model) => openAI('mistral', 'https://api.mistral.ai/v1', 'MISTRAL_API_KEY', 1200, model);

/* The free candidates as of November 2026. Gemma on the Gemini API takes no
   JSON mode, and the gpt-oss models think unless told not to bother. */
const CANDIDATES = [
  gemini('gemini-3.5-flash-lite'),
  gemini('gemini-3.5-flash-lite', { thinking: 'minimal' }),
  gemini('gemini-3.1-flash-lite'),
  gemini('gemini-3.1-flash-lite', { thinking: 'minimal' }),
  gemini('gemma-4-26b-a4b-it', { json: false }),
  gemini('gemma-4-31b-it', { json: false }),
  groq('openai/gpt-oss-20b', { reasoning_effort: 'low' }),
  groq('openai/gpt-oss-20b', { reasoning_effort: 'medium' }),
  groq('openai/gpt-oss-120b', { reasoning_effort: 'low' }),
  /* Paid, at a fraction of a cent per thousand calls: no daily cap, and
     limited to full or 8-bit precision providers that do not keep or train
     on what they are sent. Needs credit on the OpenRouter account. */
  openrouter('google/gemma-4-26b-a4b-it', { provider: { data_collection: 'deny', quantizations: ['bf16', 'fp8'], sort: 'latency' } }),
  openrouter('google/gemma-4-31b-it', { provider: { data_collection: 'deny', quantizations: ['bf16', 'fp8'], sort: 'latency' } }),
  openrouter('google/gemma-4-26b-a4b-it:free'),
  openrouter('google/gemma-4-31b-it:free'),
  openrouter('nvidia/nemotron-3.5-lightning:free'),
  openrouter('baidu/ernie-5.5-flash-preview:free'),
  openrouter('inclusionai/ling-3.2-flash:free'),
  openrouter('liquid/lfm-3-1.7b:free'),
  openrouter('recursive/flint-v1.0:free'),
  mistral('mistral-small-latest'),
  mistral('ministral-8b-latest'),
];

// ---------------------------------------------------------------- the run

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const cases = CASES.filter((item) => {
  if (gradeAnswer(item.response, item.correct).isCorrect) {
    console.warn(`  (dropped: the letters already accept "${item.response}" for "${item.correct}")`);
    return false;
  }
  return true;
});

if (args.includes('--list')) {
  for (const m of CANDIDATES) console.log(`${m.key ? 'ready  ' : 'no key '} ${m.provider.padEnd(11)} ${m.model}`);
  console.log(`\n${cases.length} cases: ${cases.filter((x) => x.right).length} to accept, ${cases.filter((x) => !x.right).length} to reject`);
  process.exit(0);
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const percentile = (xs, p) => {
  if (!xs.length) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

async function bench(candidate) {
  const misses = [];
  let correct = 0; let falseAccepts = 0; let falseRejects = 0; let unreadable = 0;
  const batchMs = [];
  const errors = new Set();

  for (let i = 0; i < cases.length; i += BATCH) {
    const chunk = cases.slice(i, i + BATCH);
    const { ms, text, error } = await timed(() => candidate.ask(judgePrompt(judgeItems(chunk))));
    batchMs.push(ms);
    const verdicts = error ? null : verdictsFrom(text, chunk.length);
    if (error) errors.add(error.slice(0, 120));
    chunk.forEach((item, k) => {
      /* No usable reply is a reject: production keeps the letters' verdict. */
      const said = verdicts ? verdicts[k] : false;
      if (!verdicts) unreadable += 1;
      if (said === item.right) correct += 1;
      else {
        if (said) falseAccepts += 1; else falseRejects += 1;
        misses.push(`${said ? 'ACCEPTED' : 'rejected'} "${item.response}" for "${item.correct}" (${item.kind})`);
      }
    });
    await pause(candidate.gapMs);
  }

  const singleMs = [];
  for (const item of cases.slice(0, SINGLES)) {
    const { ms, text, error } = await timed(() => candidate.ask(judgePrompt(judgeItems([item]))));
    if (error) errors.add(error.slice(0, 120));
    else if (verdictsFrom(text, 1)) singleMs.push(ms);
    await pause(candidate.gapMs);
  }

  return {
    provider: candidate.provider, model: candidate.label ?? candidate.model,
    accuracy: correct / cases.length, correct, total: cases.length,
    falseAccepts, falseRejects, unreadable,
    singleP50: percentile(singleMs, 0.5), singleMax: singleMs.length ? Math.max(...singleMs) : NaN,
    overBudget: singleMs.filter((ms) => ms > PRODUCTION_BUDGET_MS).length, singles: singleMs.length,
    batchP50: percentile(batchMs, 0.5),
    errors: [...errors], misses,
  };
}

const chosen = CANDIDATES.filter((m) => m.key && (!only || m.model.includes(only) || m.provider === only));
if (!chosen.length) {
  console.log('No candidate has a key. Set GEMINI_FREE_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY or MISTRAL_API_KEY; --list shows them all.');
  process.exit(1);
}
console.log(`${cases.length} cases, ${chosen.length} models\n`);

/* Providers in parallel, each one's models in turn, so every provider's own
   rate limit is respected and the run takes as long as the slowest one. */
const byProvider = new Map();
for (const m of chosen) byProvider.set(m.provider, [...(byProvider.get(m.provider) ?? []), m]);
const results = (await Promise.all([...byProvider.values()].map(async (models) => {
  const out = [];
  for (const m of models) {
    process.stdout.write(`  running ${m.provider} ${m.label ?? m.model}\n`);
    out.push(await bench(m));
  }
  return out;
}))).flat();

results.sort((a, b) => (a.falseAccepts - b.falseAccepts) || (b.accuracy - a.accuracy) || (a.singleP50 - b.singleP50));

const ms = (v) => (Number.isFinite(v) ? `${Math.round(v)}ms` : '-');
console.log('\nmodel                                         right   false+  false-  unread  1-clue p50  max     >2.5s  batch p50');
for (const r of results) {
  console.log(
    `${`${r.provider}/${r.model}`.padEnd(45)} ${`${(r.accuracy * 100).toFixed(0)}%`.padStart(5)}   ${String(r.falseAccepts).padStart(6)}  ${String(r.falseRejects).padStart(6)}  ${String(r.unreadable).padStart(6)}  ${ms(r.singleP50).padStart(10)}  ${ms(r.singleMax).padStart(6)}  ${`${r.overBudget}/${r.singles}`.padStart(5)}  ${ms(r.batchP50).padStart(9)}`,
  );
}
for (const r of results) {
  if (!r.misses.length && !r.errors.length) continue;
  console.log(`\n${r.provider}/${r.model}`);
  for (const e of r.errors) console.log(`  error: ${e}`);
  for (const m of r.misses) console.log(`  ${m}`);
}

if (args.includes('--json')) {
  const { writeFileSync } = await import('node:fs');
  const path = args[args.indexOf('--json') + 1];
  writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), cases: cases.length, results }, null, 2));
  console.log(`\nwrote ${path}`);
}
