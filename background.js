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
    // Show loading UI on the page
    chrome.tabs.sendMessage(tab.id, { action: "showLoading" }).catch(e => console.error(e));

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

    try {
      const response = await fetch("http://localhost:3000/verify", {
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
      chrome.tabs.sendMessage(tab.id, { action: "showResult", result }).catch(e => console.error(e));
    } catch (error) {
      console.error(error);
      chrome.tabs.sendMessage(tab.id, { 
        action: "showResult", 
        result: { verdict: "Error", explanation: "Failed to connect to backend.", sources: [] }
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
