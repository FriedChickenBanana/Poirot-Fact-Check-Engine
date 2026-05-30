document.addEventListener('DOMContentLoaded', () => {
  const historyList = document.getElementById('history-list');
  const noHistory = document.getElementById('no-history');
  const backendUrlInput = document.getElementById('backend-url');
  const saveBackendUrlButton = document.getElementById('save-backend-url');
  const backendSaveStatus = document.getElementById('backend-save-status');

  const DEFAULT_BACKEND_BASE_URL = "http://localhost:3000";

  function normalizeBaseUrl(value) {
    const trimmed = (value || "").trim();
    if (!trimmed) return DEFAULT_BACKEND_BASE_URL;
    return trimmed.replace(/\/+$/, "");
  }

  chrome.storage.local.get({ history: [] }, (data) => {
    if (data.history.length === 0) {
      noHistory.style.display = 'block';
      return;
    }

    data.history.forEach(item => {
      const div = document.createElement('div');
      div.className = 'history-item';
      
      let badgeClass = "badge-uncertain";
      if (item.verdict?.toLowerCase().includes("true")) badgeClass = "badge-true";
      else if (item.verdict?.toLowerCase().includes("false")) badgeClass = "badge-false";

      const date = new Date(item.timestamp).toLocaleString();
      const contentSnippet = item.type === 'text' 
        ? `"${item.content}"`
        : `[Image] ${item.content}`;

      div.innerHTML = `
        <div class="item-header">
          <span class="item-badge ${badgeClass}">${item.verdict || "Uncertain"}</span>
          <span class="item-time">${date}</span>
        </div>
        <div class="item-content" title="${item.content}">${contentSnippet}</div>
        <div class="item-explanation">${item.explanation || ""}</div>
      `;
      historyList.appendChild(div);
    });
  });

  chrome.storage.sync.get({ backendBaseUrl: DEFAULT_BACKEND_BASE_URL }, (data) => {
    backendUrlInput.value = normalizeBaseUrl(data.backendBaseUrl);
  });

  function saveBackendUrl() {
    const normalized = normalizeBaseUrl(backendUrlInput.value);
    chrome.storage.sync.set({ backendBaseUrl: normalized }, () => {
      backendUrlInput.value = normalized;
      backendSaveStatus.textContent = "Saved";
      setTimeout(() => {
        backendSaveStatus.textContent = "";
      }, 2000);
    });
  }

  saveBackendUrlButton.addEventListener('click', saveBackendUrl);
  backendUrlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveBackendUrl();
  });
});
