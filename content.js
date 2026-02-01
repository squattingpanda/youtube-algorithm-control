// YouTube Algorithm Control - Content Script
// Phase 1: Detect and log video thumbnails from the YouTube homepage
// Phase 2: Read user preferences from Chrome storage
// Phase 3: Send videos to background script for LLM scoring

// Current state — updated from storage
let currentPreferences = '';
let filteringEnabled = true;
let scoringInProgress = false;
let lastErrorTime = 0;
const ERROR_COOLDOWN = 60000; // Wait 60s before retrying after an error

// Load initial settings
chrome.storage.local.get(['preferences', 'enabled'], (data) => {
  currentPreferences = data.preferences || '';
  filteringEnabled = data.enabled !== false;
  console.log(`[YT-Control] Preferences: "${currentPreferences || '(none set)'}"`);
  console.log(`[YT-Control] Filtering: ${filteringEnabled ? 'ON' : 'OFF'}`);
});

// Listen for changes from the popup
chrome.storage.onChanged.addListener((changes) => {
  if (changes.preferences) {
    currentPreferences = changes.preferences.newValue || '';
    console.log(`[YT-Control] Preferences updated: "${currentPreferences}"`);
    // Re-score with new preferences
    processVideos();
  }
  if (changes.enabled) {
    filteringEnabled = changes.enabled.newValue !== false;
    console.log(`[YT-Control] Filtering ${filteringEnabled ? 'ON' : 'OFF'}`);
    if (filteringEnabled) processVideos();
  }
});

function extractVideoData() {
  const items = document.querySelectorAll('ytd-rich-item-renderer');
  const videos = [];

  items.forEach(item => {
    const video = parseVideoElement(item);
    if (video) videos.push(video);
  });

  return videos;
}

function parseVideoElement(item) {
  // Skip Shorts — they use shortsLockupViewModelHostEndpoint links
  if (item.querySelector('[class*="shortsLockupViewModelHost"]')) {
    return null;
  }

  // Title: lives in h3 > a inside the new yt-lockup-view-model components
  const titleEl = item.querySelector('h3 a');
  const title = titleEl ? titleEl.textContent.trim() : null;

  if (!title) return null;

  // Video URL from the same h3 a element
  const url = titleEl ? titleEl.href : null;

  // Channel name: inside yt-content-metadata-view-model > a
  const metaModel = item.querySelector('yt-content-metadata-view-model');
  const channelLink = metaModel ? metaModel.querySelector('a') : null;
  const channel = channelLink ? channelLink.textContent.trim() : null;

  // Thumbnail image
  const thumbImg = item.querySelector('yt-thumbnail-view-model img');
  const thumbnail = thumbImg ? thumbImg.src : null;

  // Duration badge: inside the bottom overlay
  const durationEl = item.querySelector(
    'yt-thumbnail-bottom-overlay-view-model .yt-badge-shape__text'
  );
  const duration = durationEl ? durationEl.textContent.trim() : null;

  // Metadata (views, time ago): spans in yt-content-metadata-view-model
  const metaSpans = metaModel
    ? [...metaModel.querySelectorAll(
        'span.yt-content-metadata-view-model__metadata-text'
      )]
    : [];
  const meta = metaSpans.map(s => s.textContent.trim()).filter(Boolean).join(' · ');

  return { title, channel, url, thumbnail, duration, meta };
}

async function processVideos() {
  if (!filteringEnabled) {
    console.log('[YT-Control] Filtering disabled — skipping scan.');
    return;
  }

  const videos = extractVideoData();
  if (videos.length === 0) {
    console.log('[YT-Control] No videos found yet.');
    return;
  }

  console.log(`[YT-Control] Found ${videos.length} videos.`);

  // If no preferences set, just log the videos without scoring
  if (!currentPreferences) {
    console.log('[YT-Control] No preferences set — skipping scoring.');
    console.table(
      videos.map((v, i) => ({
        '#': i + 1,
        Title: v.title?.substring(0, 60),
        Channel: v.channel,
        Duration: v.duration,
      }))
    );
    return;
  }

  // Avoid overlapping API calls
  if (scoringInProgress) {
    console.log('[YT-Control] Scoring already in progress, skipping.');
    return;
  }

  // Back off after errors (don't hammer a rate-limited API)
  if (lastErrorTime && Date.now() - lastErrorTime < ERROR_COOLDOWN) {
    const wait = Math.ceil((ERROR_COOLDOWN - (Date.now() - lastErrorTime)) / 1000);
    console.log(`[YT-Control] Cooling down after error, retrying in ${wait}s`);
    return;
  }

  scoringInProgress = true;
  console.log('[YT-Control] Sending videos to Gemini for scoring...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'scoreVideos',
      videos: videos.map(v => ({
        title: v.title,
        channel: v.channel,
        duration: v.duration,
        meta: v.meta,
      })),
      preferences: currentPreferences,
    });

    if (response.error) {
      console.warn(`[YT-Control] Scoring error: ${response.error}`);
      lastErrorTime = Date.now();
      console.log('[YT-Control] Will retry in 60s.');
      return;
    }

    console.log(`[YT-Control] Scores received:`);
    console.table(
      videos.map((v, i) => ({
        '#': i + 1,
        Score: response.scores[i]?.toFixed(2),
        Title: v.title?.substring(0, 55),
        Channel: v.channel,
      }))
    );
  } catch (err) {
    console.error('[YT-Control] Failed to get scores:', err);
  } finally {
    scoringInProgress = false;
  }
}

// YouTube is an SPA — content loads dynamically. We use a MutationObserver
// to detect when new video elements appear. Only re-score when the video
// count actually changes (avoids hammering the API on unrelated DOM changes).
let debounceTimer = null;
let lastVideoCount = 0;

const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const currentCount = document.querySelectorAll('ytd-rich-item-renderer').length;
    if (currentCount !== lastVideoCount) {
      lastVideoCount = currentCount;
      processVideos();
    }
  }, 2000);
});

observer.observe(document.body, { childList: true, subtree: true });

// Also run once on initial load
setTimeout(processVideos, 2500);

console.log('[YT-Control] Extension loaded. Watching for videos...');
