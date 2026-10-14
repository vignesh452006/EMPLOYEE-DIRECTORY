/**
 * Minimal Google Gemini client (no SDK dependency — uses Node 18+ global fetch).
 *
 * Configuration (environment variables — never hard-code the key):
 *   GEMINI_API_KEY   required to enable AI features
 *   GEMINI_MODEL     optional, default "gemini-2.5-flash"
 *   GEMINI_API_BASE  optional full base URL override
 *
 * Key formats:
 *   - "AIza..." keys   -> Gemini Developer API (generativelanguage.googleapis.com)
 *   - "AQ...."  keys   -> Vertex AI express-mode API (aiplatform.googleapis.com)
 */
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const TIMEOUT_MS = 25000;

function getKey() {
  return (process.env.GEMINI_API_KEY || '').trim();
}

function isConfigured() {
  return getKey().length > 0;
}

function endpointFor(model, key) {
  if (process.env.GEMINI_API_BASE) {
    return `${process.env.GEMINI_API_BASE.replace(/\/$/, '')}/models/${model}:generateContent`;
  }
  if (key.startsWith('AQ.')) {
    return `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent`;
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/**
 * @param {object} opts
 * @param {string} opts.prompt   user content (treated as DATA, not instructions)
 * @param {string} [opts.system] system instruction
 * @param {boolean} [opts.json]  request a JSON response
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @returns {Promise<string>} raw text
 */
async function generate({ prompt, system, json = false, temperature = 0.4, maxTokens = 1024 }) {
  const key = getKey();
  if (!key) {
    const err = new Error('Gemini API key is not configured');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (json) body.generationConfig.responseMimeType = 'application/json';
  // 2.5-flash "thinks" by default and thinking tokens eat the output budget; our tasks don't need it.
  if (/2\.5-flash/.test(MODEL)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(endpointFor(MODEL, key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? 'Gemini request timed out' : `Gemini request failed: ${e.message}`);
    err.code = 'AI_NETWORK';
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
    const err = new Error(`Gemini API error ${res.status}${detail ? `: ${detail}` : ''}`);
    err.code = res.status === 429 ? 'AI_RATE_LIMIT' : 'AI_API';
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const candidate = data.candidates && data.candidates[0];
  const text = candidate && candidate.content && candidate.content.parts
    ? candidate.content.parts.map((p) => p.text || '').join('')
    : '';
  if (!text) {
    const err = new Error(`Gemini returned no content${candidate && candidate.finishReason ? ` (${candidate.finishReason})` : ''}`);
    err.code = 'AI_EMPTY';
    throw err;
  }
  return text;
}

/** generate() + tolerant JSON parsing (strips ```json fences). */
async function generateJSON(opts) {
  const text = await generate({ ...opts, json: true });
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const err = new Error('Gemini returned invalid JSON');
    err.code = 'AI_BAD_JSON';
    throw err;
  }
}

module.exports = { generate, generateJSON, isConfigured, MODEL };
