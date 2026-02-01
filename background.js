// YouTube Algorithm Control - Background Service Worker
// Phase 3: Gemini API integration for scoring videos against user preferences

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// In-memory score cache: "title|channel|prefs" → score
const scoreCache = new Map();
let cachedPreferences = '';

// Clear cache when preferences change
chrome.storage.onChanged.addListener((changes) => {
  if (changes.preferences) {
    cachedPreferences = changes.preferences.newValue || '';
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
    return true; // keeps the message channel open for async response
  }
});

async function handleScoreRequest(videos, preferences) {
  if (!preferences) {
    return { error: 'No preferences set' };
  }

  // Get API key from storage
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
      results[i] = null; // placeholder
    }
  }

  console.log(`[YT-Control BG] ${scoreCache.size} cached, ${uncached.length} to score`);

  if (uncached.length === 0) {
    return { scores: results };
  }

  // Build the video list for the prompt
  const videoList = uncached.map((v, i) =>
    `${i + 1}. "${v.title}" by ${v.channel || 'Unknown'} [${v.duration || '?'}] (${v.meta || ''})`
  ).join('\n');

  const prompt = `You are a YouTube recommendation filter. The user wants to see:
"${preferences}"

Score each video below from 0.0 (completely irrelevant) to 1.0 (perfect match).
Consider the title, channel name, duration, and metadata.
Be generous with borderline content — only score very low if clearly unwanted.

Videos:
${videoList}

Respond with ONLY a JSON array of numbers, one score per video, in the same order.
Example: [0.9, 0.2, 0.7]`;

  // Single attempt — no retries here. Content script handles cooldown on 429.
  // Retrying in the background burns through the free tier's 2 RPM quota.
  let lastResponse;

  lastResponse = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  try {
    if (!lastResponse.ok) {
      const errText = await lastResponse.text();
      console.error('[YT-Control BG] API error:', lastResponse.status, errText);
      return { error: `API error ${lastResponse.status}`, retryable: lastResponse.status === 429 };
    }

    const json = await lastResponse.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return { error: 'Empty response from Gemini' };
    }

    // Parse the JSON array from the response (strip markdown code fences if present)
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const scores = JSON.parse(cleaned);

    if (!Array.isArray(scores) || scores.length !== uncached.length) {
      console.error('[YT-Control BG] Score count mismatch:', scores.length, 'vs', uncached.length);
      return { error: 'Score count mismatch from LLM' };
    }

    // Fill in results and update cache
    for (let i = 0; i < uncached.length; i++) {
      const score = Math.max(0, Math.min(1, scores[i])); // clamp 0-1
      const key = `${uncached[i].title}|${uncached[i].channel}|${preferences}`;
      scoreCache.set(key, score);
      results[uncachedIndices[i]] = score;
    }

    return { scores: results };

  } catch (err) {
    console.error('[YT-Control BG] Fetch error:', err);
    return { error: err.message };
  }
}

console.log('[YT-Control BG] Background service worker loaded.');
