// YouTube Algorithm Control - Popup Script
// Manages user preferences, API key, strictness, and enabled state via Chrome storage

const prefsEl = document.getElementById('preferences');
const enabledEl = document.getElementById('enabled');
const apiKeyEl = document.getElementById('apiKey');
const strictnessEl = document.getElementById('strictness');
const strictnessLabel = document.getElementById('strictnessLabel');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');
const presetsEl = document.getElementById('presets');

const STRICTNESS_LABELS = {
  1: 'Relaxed',
  2: 'Light',
  3: 'Balanced',
  4: 'Strict',
  5: 'Aggressive',
};

// Load saved settings when popup opens
chrome.storage.local.get(['preferences', 'enabled', 'apiKey', 'strictness'], (data) => {
  if (data.preferences) prefsEl.value = data.preferences;
  if (data.apiKey) apiKeyEl.value = data.apiKey;
  enabledEl.checked = data.enabled !== false;
  const s = data.strictness || 3;
  strictnessEl.value = s;
  strictnessLabel.textContent = STRICTNESS_LABELS[s];
});

// Update strictness label as slider moves
strictnessEl.addEventListener('input', () => {
  strictnessLabel.textContent = STRICTNESS_LABELS[strictnessEl.value];
});

// Save strictness immediately on change (instant re-filter, no API call)
strictnessEl.addEventListener('change', () => {
  chrome.storage.local.set({ strictness: parseInt(strictnessEl.value) });
});

// Preset buttons fill the textarea
presetsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.preset-btn');
  if (!btn) return;
  prefsEl.value = btn.dataset.preset;
});

// Save on button click
saveBtn.addEventListener('click', () => {
  const preferences = prefsEl.value.trim();
  const enabled = enabledEl.checked;
  const apiKey = apiKeyEl.value.trim();
  const strictness = parseInt(strictnessEl.value);

  chrome.storage.local.set({ preferences, enabled, apiKey, strictness }, () => {
    statusEl.textContent = 'Saved ✓';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });
});

// Also save immediately when toggle changes
enabledEl.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: enabledEl.checked });
});
