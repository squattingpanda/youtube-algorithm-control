// YouTube Algorithm Control - Popup Script
// Manages user preferences, API key, and enabled state via Chrome storage

const prefsEl = document.getElementById('preferences');
const enabledEl = document.getElementById('enabled');
const apiKeyEl = document.getElementById('apiKey');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

// Load saved settings when popup opens
chrome.storage.local.get(['preferences', 'enabled', 'apiKey'], (data) => {
  if (data.preferences) prefsEl.value = data.preferences;
  if (data.apiKey) apiKeyEl.value = data.apiKey;
  // Default to enabled if never set
  enabledEl.checked = data.enabled !== false;
});

// Save on button click
saveBtn.addEventListener('click', () => {
  const preferences = prefsEl.value.trim();
  const enabled = enabledEl.checked;
  const apiKey = apiKeyEl.value.trim();

  chrome.storage.local.set({ preferences, enabled, apiKey }, () => {
    statusEl.textContent = 'Saved ✓';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });
});

// Also save immediately when toggle changes
enabledEl.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: enabledEl.checked });
});
