// YouTube Algorithm Control - Content Script
// Phase 1: Detect and log video thumbnails from the YouTube homepage
// Phase 2: Read user preferences from Chrome storage

// Current state — updated from storage
let currentPreferences = '';
let filteringEnabled = true;

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
  }
  if (changes.enabled) {
    filteringEnabled = changes.enabled.newValue !== false;
    console.log(`[YT-Control] Filtering ${filteringEnabled ? 'ON' : 'OFF'}`);
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

function logVideos() {
  if (!filteringEnabled) {
    console.log('[YT-Control] Filtering disabled — skipping scan.');
    return;
  }

  const videos = extractVideoData();
  if (videos.length === 0) {
    console.log('[YT-Control] No videos found yet.');
    return;
  }

  console.log(`[YT-Control] Found ${videos.length} videos (prefs: "${currentPreferences || 'none'}"):`);
  console.table(
    videos.map((v, i) => ({
      '#': i + 1,
      Title: v.title?.substring(0, 60),
      Channel: v.channel,
      Duration: v.duration,
      Meta: v.meta?.substring(0, 40),
    }))
  );
}

// YouTube is an SPA — content loads dynamically. We use a MutationObserver
// to detect when new video elements appear.
let debounceTimer = null;

const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(logVideos, 1500);
});

observer.observe(document.body, { childList: true, subtree: true });

// Also run once on initial load
setTimeout(logVideos, 2000);

console.log('[YT-Control] Extension loaded. Watching for videos...');
