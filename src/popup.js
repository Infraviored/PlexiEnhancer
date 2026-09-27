document.addEventListener('DOMContentLoaded', () => {
  const modelInput = document.getElementById('favoriteModel');
  const getModelsBtn = document.getElementById('getModelsBtn');

  // storage key -> [checkbox id, default when unset]
  const TOGGLES = {
    hideCitations: ['hideCitationsToggle', false],
    removeComputerAds: ['removeComputerAdsToggle', true],
    applyFavoriteModel: ['applyFavoriteModelToggle', false],
    keepTabModel: ['keepTabModelToggle', true],
    enforceThinking: ['enforceThinkingToggle', false],
  };
  const SETTING_KEYS = [...Object.keys(TOGGLES), 'favoriteModel', 'availableModels'];

  function populateModels(models, favorite) {
    modelInput.innerHTML = '';
    if (models && models.length > 0) {
      models.forEach(model => {
        const opt = document.createElement('option');
        opt.value = model;
        opt.textContent = model;
        if (model === favorite) {
          opt.selected = true;
        }
        modelInput.appendChild(opt);
      });
    } else {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = "Click 'Get Models' to load";
      modelInput.appendChild(opt);
    }
  }

  function render(result) {
    for (const [key, [id, fallback]] of Object.entries(TOGGLES)) {
      document.getElementById(id).checked = typeof result[key] === 'boolean' ? result[key] : fallback;
    }
    populateModels(result.availableModels, result.favoriteModel || '');
  }

  function saveSetting(settings) {
    chrome.storage.local.set(settings, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          // tabs without our content script (non-Perplexity pages) have no receiver: ignore that
          chrome.tabs.sendMessage(tabs[0].id, { action: 'updateSettings', settings }, () => void chrome.runtime.lastError);
        }
      });
    });
  }

  // Load current state
  chrome.storage.local.get(SETTING_KEYS, render);

  for (const [key, [id]] of Object.entries(TOGGLES)) {
    const toggle = document.getElementById(id);
    toggle.addEventListener('change', () => saveSetting({ [key]: toggle.checked }));
  }

  modelInput.addEventListener('change', () => {
    saveSetting({ favoriteModel: modelInput.value.trim() });
  });

  // Handle Get Models click
  getModelsBtn.addEventListener('click', () => {
    getModelsBtn.disabled = true;
    getModelsBtn.textContent = 'Fetching...';
    modelInput.disabled = true;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        alert("Error: Active tab not found.");
        getModelsBtn.disabled = false;
        getModelsBtn.textContent = 'Get Models';
        modelInput.disabled = false;
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { action: 'scrapeModels' }, (response) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr || !response || !response.success) {
          const errMsg = lastErr ? lastErr.message : (response ? response.error : 'Invalid response');
          alert("Could not scrape models: " + errMsg + "\n\nMake sure you are on a Perplexity tab and the page is loaded.");
          getModelsBtn.disabled = false;
          getModelsBtn.textContent = 'Get Models';
          modelInput.disabled = false;
          return;
        }

        // On success, reload list and favorite from local storage
        chrome.storage.local.get(['availableModels', 'favoriteModel'], (updatedResult) => {
          populateModels(updatedResult.availableModels, updatedResult.favoriteModel || '');
          getModelsBtn.disabled = false;
          getModelsBtn.textContent = 'Get Models';
          modelInput.disabled = false;
        });
      });
    });
  });

  // Listen for external settings updates (e.g. from onboarding card on the page)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'settingsUpdatedExternally') {
      chrome.storage.local.get(SETTING_KEYS, render);
    }
  });
});
