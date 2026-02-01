// YouTube Algorithm Control - Content Script
// Phase 1: Detect and log video thumbnails from the YouTube homepage
// Phase 2: Read user preferences from Chrome storage
// Phase 3: Send videos to background script for LLM scoring
// Phase 4: Visual filtering — hide/dim low-scoring videos
// Phase 5: Strictness slider, performance (only score new videos, instant re-filter)

// Strictness → threshold mapping
const STRICTNESS_MAP = {
  1: { hide: 0.05, dim: 0.2 },  // Relaxed
  2: { hide: 0.1,  dim: 0.3 },  // Light
  3: { hide: 0.2,  dim: 0.5 },  // Balanced (default)
  4: { hide: 0.3,  dim: 0.7 },  // Strict
  5: { hide: 0.5,  dim: 0.8 },  // Aggressive
};

// Current state — updated from storage
let currentPreferences = '';
let filteringEnabled = true;
let currentStrictness = 3;
let scoringInProgress = false;
let lastErrorTime = 0;
const ERROR_COOLDOWN = 60000; // Wait 60s before retrying after an error

// Score map: DOM element → score (for instant re-filter on strictness change)
const scoreMap = new WeakMap();

// Load initial settings
chrome.storage.local.get(['preferences', 'enabled', 'strictness'], (data) => {
  currentPreferences = data.preferences || '';
  filteringEnabled = data.enabled !== false;
  currentStrictness = data.strictness || 3;
  console.log(`[YT-Control] Preferences: "${currentPreferences || '(none set)'}"`);
  console.log(`[YT-Control] Filtering: ${filteringEnabled ? 'ON' : 'OFF'}, Strictness: ${currentStrictness}`);
});

// Listen for changes from the popup
chrome.storage.onChanged.addListener((changes) => {
  if (changes.preferences) {
    currentPreferences = changes.preferences.newValue || '';
    console.log(`[YT-Control] Preferences updated: "${currentPreferences}"`);
    // Clear scored state — need to re-score everything with new prefs
    clearScoredState();
    resetAllFilters();
    processVideos();
  }
  if (changes.enabled) {
    filteringEnabled = changes.enabled.newValue !== false;
    console.log(`[YT-Control] Filtering ${filteringEnabled ? 'ON' : 'OFF'}`);
    if (filteringEnabled) {
      processVideos();
    } else {
      resetAllFilters();
    }
  }
  if (changes.strictness) {
    currentStrictness = changes.strictness.newValue || 3;
    console.log(`[YT-Control] Strictness changed to ${currentStrictness}`);
    // Re-apply filters from cached scores — no API call needed
    reapplyFilters();
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

  // Return the DOM element too so we can apply visual filters
  return { title, channel, url, thumbnail, duration, meta, element: item };
}

// Get current thresholds based on strictness
function getThresholds() {
  return STRICTNESS_MAP[currentStrictness] || STRICTNESS_MAP[3];
}

// Apply visual filter to a video element based on its score
function applyFilter(element, score) {
  const { hide, dim } = getThresholds();

  if (score < hide) {
    element.style.display = 'none';
    element.dataset.ytcFilter = 'hidden';
  } else if (score < dim) {
    element.style.opacity = '0.3';
    element.style.transition = 'opacity 0.3s';
    element.dataset.ytcFilter = 'dimmed';
    // Restore on hover so user can still see/click if curious
    element.addEventListener('mouseenter', handleHoverIn);
    element.addEventListener('mouseleave', handleHoverOut);
  } else {
    element.style.opacity = '';
    element.style.display = '';
    element.dataset.ytcFilter = 'shown';
    // Clean up hover listeners if previously dimmed
    element.removeEventListener('mouseenter', handleHoverIn);
    element.removeEventListener('mouseleave', handleHoverOut);
  }
}

function handleHoverIn(e) {
  e.currentTarget.style.opacity = '1';
}

function handleHoverOut(e) {
  if (e.currentTarget.dataset.ytcFilter === 'dimmed') {
    e.currentTarget.style.opacity = '0.3';
  }
}

// Re-apply filters from cached scores (instant, no API call)
function reapplyFilters() {
  if (!filteringEnabled) return;

  let hidden = 0, dimmed = 0, shown = 0;
  const { hide, dim } = getThresholds();

  document.querySelectorAll('ytd-rich-item-renderer').forEach(item => {
    if (!scoreMap.has(item)) return;
    const score = scoreMap.get(item);
    applyFilter(item, score);
    if (score < hide) hidden++;
    else if (score < dim) dimmed++;
    else shown++;
  });

  console.log(`[YT-Control] Re-filtered (strictness ${currentStrictness}): ${shown} shown, ${dimmed} dimmed, ${hidden} hidden`);
}

// Remove all visual filters (when disabled or preferences change)
function resetAllFilters() {
  document.querySelectorAll('ytd-rich-item-renderer').forEach(item => {
    item.style.opacity = '';
    item.style.display = '';
    item.dataset.ytcFilter = '';
    item.removeEventListener('mouseenter', handleHoverIn);
    item.removeEventListener('mouseleave', handleHoverOut);
  });
}

// Clear scored state so all videos get re-scored
function clearScoredState() {
  document.querySelectorAll('ytd-rich-item-renderer[data-ytc-scored]').forEach(item => {
    delete item.dataset.ytcScored;
  });
}

// Hide unscored videos immediately (pending state) so user never sees unfiltered content
function applyPendingState(videos) {
  videos.forEach(v => {
    if (!v.element.dataset.ytcScored) {
      v.element.style.opacity = '0';
      v.element.style.transition = 'opacity 0.3s';
      v.element.dataset.ytcFilter = 'pending';
    }
  });
}

async function processVideos() {
  if (!filteringEnabled) {
    console.log('[YT-Control] Filtering disabled — skipping scan.');
    return;
  }

  const allVideos = extractVideoData();
  if (allVideos.length === 0) {
    console.log('[YT-Control] No videos found yet.');
    return;
  }

  // Only send unscored videos to the API
  const unscoredVideos = allVideos.filter(v => !v.element.dataset.ytcScored);

  // If no preferences or nothing to score, skip
  if (!currentPreferences || unscoredVideos.length === 0) {
    if (!currentPreferences && unscoredVideos.length > 0) {
      console.log('[YT-Control] No preferences set — skipping scoring.');
    }
    return;
  }

  console.log(`[YT-Control] Found ${allVideos.length} videos (${unscoredVideos.length} new).`);

  // Immediately hide unscored videos so there's no "flash" of unfiltered content
  applyPendingState(unscoredVideos);

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
  console.log(`[YT-Control] Sending ${unscoredVideos.length} videos to Gemini for scoring...`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'scoreVideos',
      videos: unscoredVideos.map(v => ({
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
      // Unhide pending videos on error so page isn't blank
      unscoredVideos.forEach(v => {
        v.element.style.opacity = '';
        v.element.style.display = '';
        v.element.dataset.ytcFilter = '';
      });
      console.log('[YT-Control] Will retry in 60s.');
      return;
    }

    // Apply visual filters, store scores, and mark as scored
    const { hide, dim } = getThresholds();
    let hidden = 0, dimmed = 0, shown = 0;

    unscoredVideos.forEach((v, i) => {
      const score = response.scores[i];
      scoreMap.set(v.element, score);
      v.element.dataset.ytcScored = '1';
      applyFilter(v.element, score);
      if (score < hide) hidden++;
      else if (score < dim) dimmed++;
      else shown++;
    });

    console.log(`[YT-Control] Filtered: ${shown} shown, ${dimmed} dimmed, ${hidden} hidden`);
    console.table(
      unscoredVideos.map((v, i) => ({
        '#': i + 1,
        Score: response.scores[i]?.toFixed(2),
        Filter: response.scores[i] < hide ? '🚫 HIDDEN'
          : response.scores[i] < dim ? '👻 DIMMED' : '✅ SHOWN',
        Title: v.title?.substring(0, 50),
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
  }, 800);
});

observer.observe(document.body, { childList: true, subtree: true });

// Run as soon as possible on initial load
setTimeout(processVideos, 500);

console.log('[YT-Control] Extension loaded. Watching for videos...');
