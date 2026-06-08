const DEFAULT_BACKEND_BASE_URL = "http://localhost:3000";

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

    // Generate a unique request ID so concurrent fact-checks don't clobber each other
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Show loading UI, inject scripts dynamically if they are missing (common after extension reload)
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "showLoading", requestId });
    } catch (e) {
      console.warn("Content script disconnected or missing. Injecting dynamically...", e);
      try {
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        await chrome.tabs.sendMessage(tab.id, { action: "showLoading", requestId });
      } catch (injectionError) {
        console.error("Failed to inject UI:", injectionError);
        return; // Abort if we literally can't show the UI
      }
    }

    // Persona drives how the verdict is tailored (defaults to General Public).
    const { persona = "General Public" } = await chrome.storage.sync.get({ persona: "General Public" });

    let payload;
    if (info.menuItemId === "verifyClaim") {
      payload = { type: "text", content: info.selectionText, persona };
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
        
        payload = { type: "image", content: info.srcUrl, base64: `data:${mimeType};base64,${base64}`, persona };
      } catch (err) {
        console.error("Failed to fetch image:", err);
        payload = { type: "image", content: info.srcUrl, persona };
      }
    }

    try {
      const baseUrl = await getBackendBaseUrl();
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

      // Send result back to content script.
      // IMPORTANT: Do NOT include payload.base64 here — large base64 strings
      // (multi-MB images) exceed Chrome's message-passing size limits and cause
      // the message to silently fail, leaving the UI stuck on "loading".
      // The base64 is only needed for the feedback flow; store it separately.
      if (payload.base64) {
        // Persist the base64 keyed by requestId so the feedback form can retrieve it
        chrome.storage.session.set({ [`fb64_${requestId}`]: payload.base64 }).catch(() => {});
      }
      chrome.tabs.sendMessage(tab.id, { 
        action: "showResult", 
        requestId,
        result: {
          ...result,
          originalType: payload.type,
          originalContent: payload.content,
          requestId
        }
      }).catch(e => console.error("sendMessage failed:", e));
    } catch (error) {
      console.error(error);
      chrome.tabs.sendMessage(tab.id, { 
        action: "showResult",
        requestId,
        result: { verdict: "Error", explanation: "Failed to connect to backend.", sources: [] }
      }).catch(e => console.error("sendMessage failed:", e));
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
    (async () => {
      const feedbackPayload = { ...request.payload };
      // Resolve the image base64 from session storage if a requestId was provided
      if (feedbackPayload.requestId) {
        const key = `fb64_${feedbackPayload.requestId}`;
        try {
          const stored = await chrome.storage.session.get(key);
          feedbackPayload.base64 = stored[key] || "";
          chrome.storage.session.remove(key).catch(() => {});
        } catch { feedbackPayload.base64 = ""; }
        delete feedbackPayload.requestId;
      }
      const baseUrl = await getBackendBaseUrl();
      fetch(buildBackendUrl(baseUrl, "/feedback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(feedbackPayload)
      }).catch(e => console.error("Ext Fetch Error:", e));
    })();
  }
});
