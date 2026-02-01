// YouTube Algorithm Control - Background Service Worker
// Gemini API integration for scoring videos against user preferences

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Model rotation: spread requests across 3 models to maximize throughput
// Each has its own rate limit (5-10 RPM each = ~20 RPM combined)
const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3-flash',
];
let modelIndex = 0;
const modelLastUsed = new Map(); // model → timestamp
const PER_MODEL_GAP_MS = 13000; // 13s per model ≈ safe under 5 RPM each

function getNextModel() {
  // Find a model that isn't rate-limited
  for (let i = 0; i < MODELS.length; i++) {
    const idx = (modelIndex + i) % MODELS.length;
    const model = MODELS[idx];
    const lastUsed = modelLastUsed.get(model) || 0;
    if (Date.now() - lastUsed >= PER_MODEL_GAP_MS) {
      modelIndex = (idx + 1) % MODELS.length;
      return model;
    }
  }
  // All rate-limited — return the one that will be available soonest
  let bestModel = MODELS[0];
  let bestWait = Infinity;
  for (const model of MODELS) {
    const wait = PER_MODEL_GAP_MS - (Date.now() - (modelLastUsed.get(model) || 0));
    if (wait < bestWait) {
      bestWait = wait;
      bestModel = model;
    }
  }
  return bestModel;
}

// In-memory score cache: "title|channel|prefs" → score
const scoreCache = new Map();

// Persist errors to storage for debugging (keeps last 10)
async function logError(type, status, detail) {
  const entry = {
    time: new Date().toISOString(),
    type,
    status,
    detail: typeof detail === 'string' ? detail.substring(0, 500) : String(detail),
  };
  console.error(`[YT-Control BG] ${type}:`, status, detail);
  const data = await chrome.storage.local.get('errorLog');
  const log = (data.errorLog || []).slice(-9);
  log.push(entry);
  await chrome.storage.local.set({ errorLog: log });
}

// Clear cache when preferences change
chrome.storage.onChanged.addListener((changes) => {
  if (changes.preferences) {
    scoreCache.clear();
    console.log('[YT-Control BG] Preferences changed, cache cleared.');
  }
});

// Listen for scoring requests from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'scoreVideos') {
    handleScoreRequest(message.videos, message.preferences)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

async function handleScoreRequest(videos, preferences) {
  if (!preferences) {
    return { error: 'No preferences set' };
  }

  const data = await chrome.storage.local.get('apiKey');
  const apiKey = data.apiKey;
  if (!apiKey) {
    return { error: 'No API key set. Open the extension popup to add your Gemini API key.' };
  }

  // Split videos into cached and uncached
  const results = [];
  const uncached = [];
  const uncachedIndices = [];

  for (let i = 0; i < videos.length; i++) {
    const key = `${videos[i].title}|${videos[i].channel}|${preferences}`;
    if (scoreCache.has(key)) {
      results[i] = scoreCache.get(key);
    } else {
      uncached.push(videos[i]);
      uncachedIndices.push(i);
      results[i] = null;
    }
  }

  console.log(`[YT-Control BG] ${scoreCache.size} cached, ${uncached.length} to score`);

  if (uncached.length === 0) {
    return { scores: results };
  }

  // Build compact video list (shorter prompt = faster response)
  const videoList = uncached.map((v, i) =>
    `${i + 1}. "${v.title}" — ${v.channel || '?'}`
  ).join('\n');

  const prompt = `Score each video 0.0-1.0 for relevance to: "${preferences}"
Only score low if clearly irrelevant. Return ONLY a JSON array of numbers.

${videoList}`;

  // Pick next available model
  const model = getNextModel();
  const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;

  // Wait if this model was used too recently
  const lastUsed = modelLastUsed.get(model) || 0;
  const timeSince = Date.now() - lastUsed;
  if (timeSince < PER_MODEL_GAP_MS) {
    const waitMs = PER_MODEL_GAP_MS - timeSince;
    console.log(`[YT-Control BG] Rate limiter (${model}): waiting ${(waitMs / 1000).toFixed(1)}s`);
    await new Promise(r => setTimeout(r, waitMs));
  }
  modelLastUsed.set(model, Date.now());

  console.log(`[YT-Control BG] Using model: ${model}`);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
  } catch (err) {
    await logError('Fetch error', null, err.message);
    return { error: err.message };
  }

  try {
    if (!response.ok) {
      const errText = await response.text();
      await logError('API error', response.status, `[${model}] ${errText}`);

      // If this model is rate-limited, try another immediately
      if (response.status === 429) {
        modelLastUsed.set(model, Date.now() + 30000); // block this model for 30s extra
        const altModel = getNextModel();
        if (altModel !== model) {
          console.log(`[YT-Control BG] 429 on ${model}, retrying with ${altModel}`);
          const altUrl = `${API_BASE}/${altModel}:generateContent?key=${apiKey}`;
          modelLastUsed.set(altModel, Date.now());
          response = await fetch(altUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }]
            })
          });
          if (!response.ok) {
            const errText2 = await response.text();
            await logError('API error (fallback)', response.status, `[${altModel}] ${errText2}`);
            return { error: `API error ${response.status}` };
          }
        } else {
          return { error: `API error 429 (all models rate-limited)` };
        }
      } else {
        return { error: `API error ${response.status}` };
      }
    }

    const json = await response.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return { error: 'Empty response from Gemini' };
    }

    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const scores = JSON.parse(cleaned);

    if (!Array.isArray(scores) || scores.length !== uncached.length) {
      await logError('Score mismatch', null, `Got ${scores.length} scores for ${uncached.length} videos`);
      return { error: 'Score count mismatch from LLM' };
    }

    for (let i = 0; i < uncached.length; i++) {
      const score = Math.max(0, Math.min(1, scores[i]));
      const key = `${uncached[i].title}|${uncached[i].channel}|${preferences}`;
      scoreCache.set(key, score);
      results[uncachedIndices[i]] = score;
    }

    return { scores: results };

  } catch (err) {
    await logError('Parse error', null, err.message);
    return { error: err.message };
  }
}

console.log('[YT-Control BG] Background service worker loaded.');
