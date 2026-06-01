const DEFAULT_BACKEND_BASE_URL = "http://localhost:3000";
const DEFAULT_LANGUAGE_MODE = "auto";
const DEFAULT_LOW_BANDWIDTH = false;

function normalizeBaseUrl(value) {
  const trimmed = (value || "").trim();
  if (!trimmed) return DEFAULT_BACKEND_BASE_URL;
  return trimmed.replace(/\/+$/, "");
}

function getBackendBaseUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { backendBaseUrl: DEFAULT_BACKEND_BASE_URL },
      (data) => resolve(normalizeBaseUrl(data.backendBaseUrl))
    );
  });
}

function getUserSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        backendBaseUrl: DEFAULT_BACKEND_BASE_URL,
        languageMode: DEFAULT_LANGUAGE_MODE,
        lowBandwidth: DEFAULT_LOW_BANDWIDTH
      },
      (data) => {
        resolve({
          baseUrl: normalizeBaseUrl(data.backendBaseUrl),
          languageMode: data.languageMode || DEFAULT_LANGUAGE_MODE,
          lowBandwidth: Boolean(data.lowBandwidth)
        });
      }
    );
  });
}

function containsBengali(text) {
  return /[\u0980-\u09FF]/.test(text || "");
}

function detectTabLanguage(tabId) {
  return new Promise((resolve) => {
    if (!chrome.tabs || !chrome.tabs.detectLanguage) return resolve("en");
    chrome.tabs.detectLanguage(tabId, (lang) => {
      if (chrome.runtime.lastError) return resolve("en");
      resolve(lang || "en");
    });
  });
}

async function resolveUiLanguage(languageMode, sampleText, tabId) {
  if (languageMode === "bn" || languageMode === "en") return languageMode;
  if (containsBengali(sampleText)) return "bn";
  const tabLang = await detectTabLanguage(tabId);
  return (tabLang || "").toLowerCase().startsWith("bn") ? "bn" : "en";
}

function buildBackendUrl(baseUrl, path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "verifyClaim",
    title: "Verify Claim",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "verifyImage",
    title: "Verify Image",
    contexts: ["image"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "verifyClaim" || info.menuItemId === "verifyImage") {
    // Prevent running on restricted internal browser pages
    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:")) {
      console.error("Extensions cannot interact with internal browser pages.");
      return;
    }

    const { baseUrl, languageMode, lowBandwidth } = await getUserSettings();

    // Show loading UI, inject scripts dynamically if they are missing (common after extension reload)
    let uiLanguage = "en";
    try {
      uiLanguage = await resolveUiLanguage(languageMode, info.selectionText, tab.id);
      await chrome.tabs.sendMessage(tab.id, {
        action: "showLoading",
        uiLanguage,
        lowBandwidth
      });
    } catch (e) {
      console.warn("Content script disconnected or missing. Injecting dynamically...", e);
      try {
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        await chrome.tabs.sendMessage(tab.id, {
          action: "showLoading",
          uiLanguage,
          lowBandwidth
        });
      } catch (injectionError) {
        console.error("Failed to inject UI:", injectionError);
        return; // Abort if we literally can't show the UI
      }
    }

    let payload;
    if (info.menuItemId === "verifyClaim") {
      payload = { type: "text", content: info.selectionText };
    } else {
      try {
        const imgRes = await fetch(info.srcUrl);
        const blob = await imgRes.blob();
        const arrayBuffer = await blob.arrayBuffer();
        
        let binary = '';
        const bytes = new Uint8Array(arrayBuffer);
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        const mimeType = blob.type || 'image/jpeg';
        
        payload = { type: "image", content: info.srcUrl, base64: `data:${mimeType};base64,${base64}` };
      } catch (err) {
        console.error("Failed to fetch image:", err);
        payload = { type: "image", content: info.srcUrl };
      }
    }

    payload.language = uiLanguage;
    payload.uiLanguage = uiLanguage;
    payload.lowBandwidth = lowBandwidth;

    try {
      const response = await fetch(buildBackendUrl(baseUrl, "/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      const result = await response.json();
      
      // Save to history (excluding the giant base64 string to avoid quota limit errors)
      const historyItem = { ...result, ...payload, timestamp: Date.now() };
      delete historyItem.base64; 
      saveToHistory(historyItem);

      // Send result back to content script
      chrome.tabs.sendMessage(tab.id, { 
        action: "showResult", 
        result: {
          ...result,
          uiLanguage,
          lowBandwidth,
          originalType: payload.type,
          originalContent: payload.content,
          originalBase64: payload.base64
        }
      }).catch(e => console.error(e));
    } catch (error) {
      console.error(error);
      chrome.tabs.sendMessage(tab.id, { 
        action: "showResult", 
        result: {
          verdict: "Error",
          verdict_code: "error",
          explanation: "Failed to connect to backend.",
          sources: [],
          uiLanguage,
          lowBandwidth
        }
      }).catch(e => console.error(e));
    }
  }
});

function saveToHistory(item) {
  chrome.storage.local.get({ history: [] }, (data) => {
    let history = data.history;
    history.unshift(item);
    if (history.length > 10) history = history.slice(0, 10);
    chrome.storage.local.set({ history });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "submitFeedback") {
    getBackendBaseUrl()
      .then((baseUrl) => fetch(buildBackendUrl(baseUrl, "/feedback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.payload)
      }))
      .catch(e => console.error("Ext Fetch Error:", e));
  }
});
