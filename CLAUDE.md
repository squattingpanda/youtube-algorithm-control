# YouTube Algorithm Control Extension

## Project Brief
Chrome extension that lets users steer YouTube's algorithm with natural language preferences. Uses an LLM to score videos on the homepage against user-described preferences, hiding/dimming non-matching content. See the full brief in the original project conversation or ask Andrew.

**Repo:** https://github.com/squattingpanda/youtube-algorithm-control
**Git identity (local):** squattingpanda / andy@andrewbrowne.me

## Extension Architecture (Manifest V3)
```
youtube extension/
  manifest.json          # MV3, content script on youtube.com
  content.js             # DOM scraping + video detection
  # Future:
  popup.html / popup.js  # User preferences UI
  background.js          # LLM API calls
  core/                  # Shared filtering logic (reusable for mobile app later)
```

## Implementation Phases
1. ✅ **Phase 1: DOM Access** — Detect video thumbnails, extract titles/channels/duration, log to console
2. ✅ **Phase 2: Basic UI** — Popup with text area for preferences, Chrome storage, on/off toggle
3. ✅ **Phase 3: LLM Integration** — Background service worker calling Gemini 2.0 Flash API, batch scoring, caching
4. ✅ **Phase 4: Visual Filtering** — Hide/dim low-scoring videos, handle infinite scroll
5. ✅ **Phase 5: Polish** — Mood presets, filter strictness slider, performance optimization

## Current YouTube DOM Selectors (as of Feb 2025)
YouTube has migrated to new web components. Old selectors like `#video-title`, `ytd-channel-name` no longer work.

**Working selectors:**
- **Video containers:** `ytd-rich-item-renderer` (homepage items)
- **Title:** `h3 a` (inside each renderer)
- **Channel:** `yt-content-metadata-view-model a`
- **Duration:** `yt-thumbnail-bottom-overlay-view-model .yt-badge-shape__text`
- **Thumbnail:** `yt-thumbnail-view-model img`
- **Metadata (views/age):** `span.yt-content-metadata-view-model__metadata-text`
- **Shorts detection:** `[class*="shortsLockupViewModelHost"]` — skip these

**Sidebar videos** (`ytd-compact-video-renderer`) may use different selectors — not yet tested.

## Technical Preferences
- Manifest V3
- Vanilla JavaScript (no build step)
- Keep it simple, Andrew wants to understand every line

## Development Instructions
Always commit changes after completing and testing any instructed change.

## Session Continuity Rule
**CRITICAL: After completing any task or set of changes, ALWAYS update the Session Log at the bottom of this file before finishing.** This ensures the next Claude Code session has full context without the user needing to re-explain anything. Update the log with:
- What was done
- What's working / what's broken
- What the next steps are
- Any decisions or context that would be lost

---

# Session Log

## Session: 2025-02-01 — Fixed DOM Selectors & Git Setup
**What was done:**
- Connected to YouTube via Claude in Chrome MCP to inspect live DOM
- Discovered YouTube has fully migrated to `yt-lockup-view-model` / `yt-content-metadata-view-model` web components
- Old selectors (`#video-title`, `ytd-channel-name #text`, `img#img`, etc.) all return null
- Updated `content.js` with working selectors (see "Current YouTube DOM Selectors" above)
- Added Shorts filtering (skips items with `shortsLockupViewModelHost` class)
- Initialized git repo, pushed to GitHub (squattingpanda/youtube-algorithm-control)
- Created project-specific CLAUDE.md for session continuity

**What's working:**
- Phase 1 confirmed working ✅ — extension detects ~30+ videos, skips Shorts, extracts title/channel/duration/meta

**Next steps:**
- Phase 2 done ✅ — needs testing (reload extension, click icon, enter prefs)
- Phase 3: LLM Integration (background script, API calls, batch scoring, caching)

## Session: 2025-02-01 — Phase 2 Popup UI
**What was done:**
- Created popup.html with text area, toggle switch, save button (YouTube-red theme)
- Created popup.js for load/save via chrome.storage.local
- Updated content.js to read prefs from storage + listen for changes + respect toggle
- Updated manifest.json with action.default_popup

**What needs testing:**
- Reload extension → click icon → popup should appear
- Enter preferences, save, close, reopen → should persist
- Toggle off → console shows "Filtering disabled"
- Toggle on → normal video logging with preferences shown

**Next steps:**
- Confirm Phase 2 works, then Phase 3: LLM Integration

## Session: 2025-02-01 — Phase 3 Gemini LLM Integration
**What was done:**
- Created background.js service worker: calls Gemini 2.0 Flash API, scores videos 0-1 against preferences
- In-memory score cache (Map keyed by title|channel|preferences), clears on pref change
- Added API key input (password field) to popup
- Content script now sends video batch to background, logs score table to console
- Dedup guard prevents overlapping API calls during infinite scroll
- Added host_permissions for generativelanguage.googleapis.com
- Bumped version to 0.2.0

**What needs testing:**
- Reload extension → open popup → enter Gemini API key + preferences → save
- Open YouTube → check console for "[YT-Control] Scores received:" with score table
- Check background console (chrome://extensions → service worker link) for API call logs
- Toggle off → no API calls
- Change preferences → cache clears, re-scores

**Next steps:**
- Confirm Phase 3 works, then Phase 4: Visual Filtering (hide/dim low-scoring videos)

## Session: 2025-02-01 — Phase 4 Visual Filtering
**What was done:**
- Added visual filtering: score < 0.2 hidden, 0.2-0.5 dimmed (opacity 0.3), > 0.5 shown
- Dimmed videos restore opacity on hover so user can still see/click
- Toggle off or preference change resets all filters instantly
- Console shows filter summary: "Filtered: X shown, Y dimmed, Z hidden"
- Tested live via Claude in Chrome: 6 shown, 1 dimmed, 26 hidden with pref "tech" ✅
- Fixed 429 rate limiting: removed retry loop, added 60s cooldown, MutationObserver only fires on video count change
- Switched from gemini-2.0-flash to gemini-2.5-flash (better free tier: 10-15 RPM)

**What's working:**
- Full pipeline: detect videos → score via Gemini → hide/dim/show ✅
- Caching works (no re-scoring same videos)
- Infinite scroll triggers re-score only when new videos appear

**Next steps:**
- Phase 5: Polish (mood presets, filter strictness slider, performance optimization)

## Session: 2025-02-01 — Phase 5 Polish (ALL PHASES COMPLETE)
**What was done:**
- Added 4 mood preset buttons: 🎓 Learning, 💻 Tech, 😌 Relax, 💼 Work
- Added filter strictness slider (1-5: Relaxed → Aggressive)
- Strictness controls hide/dim thresholds, re-applies instantly from cached scores (no API call)
- Only unscored videos sent to API (data-ytc-scored tracking) — infinite scroll only scores new videos
- WeakMap stores element→score for instant re-filter on strictness change
- Added error logging to chrome.storage.local (last 10 errors with full API response body)
- Added rate limiter: 7s min gap between API calls (stays under 10 RPM free tier)
- Bumped version to 0.3.0
- Tested live via Claude in Chrome: 4 shown, 29 hidden with pref "tech" ✅

**What's working:**
- Full MVP complete: all 5 phases implemented and tested ✅
- Detect → Score → Filter pipeline with caching, rate limiting, error handling
- Popup UI: presets, preferences, strictness slider, API key, toggle
- Performance: only-score-new + instant re-filter on strictness change

**Extension is MVP-complete.** Potential future work:
- Chrome Web Store submission
- Multiple saved preference profiles
- Show/hide count badge on extension icon
- Sidebar video filtering (ytd-compact-video-renderer)
- Mobile app (WebView wrapper per brief)

## Session: 2025-02-01 — Spinner/Badge Overlays & Performance Tuning
**What was done:**
- Added model rotation across 3 Gemini models (2.5-flash, 2.5-flash-lite, 3-flash) with independent rate limits
- Reduced initial delay to 500ms and debounce to 800ms for faster perceived response
- Added loading spinner overlay (top-right of thumbnail) while videos are being scored
- Spinner replaced by colored score badge (green/yellow/red percentage) once scored
- Changed filtering to never fully hide videos — minimum opacity 0.15 for testing visibility
- Opacity gradient: score 0 → 0.15, mid → 0.4, above dim threshold → 1.0
- Error recovery removes spinners and restores full visibility
- resetAllFilters() cleans up all overlays (spinners + badges)

**What's working:**
- Full pipeline with visual feedback: spinners → badges → opacity filtering ✅
- 3-model rotation with per-model cooldowns ✅
- Nothing fully hidden — all videos remain visible at varying opacity for testing

**What needs testing:**
- Reload extension, refresh YouTube → spinners should appear on thumbnails
- After ~2-5s, spinners replaced by percentage badges with color coding
- Low-scoring videos dimmed but still visible (not hidden)
- Hover over dimmed video → restores to full opacity
- Change strictness → instant re-filter with updated badges
