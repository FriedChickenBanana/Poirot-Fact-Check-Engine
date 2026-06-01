document.addEventListener('DOMContentLoaded', () => {
  const historyList = document.getElementById('history-list');
  const noHistory = document.getElementById('no-history');
  const backendUrlInput = document.getElementById('backend-url');
  const saveBackendUrlButton = document.getElementById('save-backend-url');
  const backendSaveStatus = document.getElementById('backend-save-status');
  const languageModeSelect = document.getElementById('language-mode');
  const lowBandwidthToggle = document.getElementById('low-bandwidth');

  const DEFAULT_BACKEND_BASE_URL = "http://localhost:3000";
  const DEFAULT_LANGUAGE_MODE = "auto";

  const I18N = {
    en: {
      title: "Misinfo Detector",
      noHistory: "No recent checks found.",
      settingsTitle: "Settings",
      languageLabel: "Language",
      languageAuto: "Auto",
      languageEnglish: "English",
      languageBangla: "Bangla",
      lowBandwidth: "Low-bandwidth mode",
      backendTitle: "Backend URL",
      save: "Save",
      saved: "Saved",
      backendHelp: "Paste your ngrok HTTPS forwarding URL here.",
      verdictTrue: "Likely True",
      verdictFalse: "Likely False",
      verdictUncertain: "Uncertain",
      verdictSatirical: "Satirical",
      verdictError: "Error"
    },
    bn: {
      title: "ভুল তথ্য শনাক্তকরণ",
      noHistory: "সাম্প্রতিক যাচাই পাওয়া যায়নি।",
      settingsTitle: "সেটিংস",
      languageLabel: "ভাষা",
      languageAuto: "স্বয়ংক্রিয়",
      languageEnglish: "ইংরেজি",
      languageBangla: "বাংলা",
      lowBandwidth: "লো-ব্যান্ডউইথ মোড",
      backendTitle: "ব্যাকএন্ড URL",
      save: "সংরক্ষণ",
      saved: "সংরক্ষণ হয়েছে",
      backendHelp: "আপনার ngrok HTTPS ফরওয়ার্ডিং URL এখানে দিন।",
      verdictTrue: "সম্ভবত সত্য",
      verdictFalse: "সম্ভবত মিথ্যা",
      verdictUncertain: "অনিশ্চিত",
      verdictSatirical: "ব্যঙ্গাত্মক",
      verdictError: "ত্রুটি"
    }
  };

  const VERDICT_LABELS = {
    en: {
      true: "Likely True",
      false: "Likely False",
      uncertain: "Uncertain",
      satirical: "Satirical",
      error: "Error"
    },
    bn: {
      true: "সম্ভবত সত্য",
      false: "সম্ভবত মিথ্যা",
      uncertain: "অনিশ্চিত",
      satirical: "ব্যঙ্গাত্মক",
      error: "ত্রুটি"
    }
  };

  let historyCache = [];
  let currentUiLanguage = "en";

  function normalizeBaseUrl(value) {
    const trimmed = (value || "").trim();
    if (!trimmed) return DEFAULT_BACKEND_BASE_URL;
    return trimmed.replace(/\/+$/, "");
  }

  function resolveUiLanguage(mode) {
    if (mode === "bn") return "bn";
    if (mode === "en") return "en";
    const browserLang = (navigator.language || "en").toLowerCase();
    return browserLang.startsWith("bn") ? "bn" : "en";
  }

  function setStatusSaved() {
    backendSaveStatus.textContent = I18N[currentUiLanguage]?.saved || "Saved";
    setTimeout(() => {
      backendSaveStatus.textContent = "";
    }, 2000);
  }

  function applyTranslations(language) {
    currentUiLanguage = language;
    const dictionary = I18N[language] || I18N.en;
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const key = node.getAttribute("data-i18n");
      if (dictionary[key]) node.textContent = dictionary[key];
    });
  }

  function normalizeVerdictCode(verdict) {
    const value = (verdict || "").toLowerCase();
    if (value.includes("satir") || value.includes("ব্যঙ্গ")) return "satirical";
    if (value.includes("false") || value.includes("মিথ্যা")) return "false";
    if (value.includes("true") || value.includes("সত্য")) return "true";
    if (value.includes("error") || value.includes("ত্রুটি")) return "error";
    if (value.includes("uncertain") || value.includes("অনিশ্চিত")) return "uncertain";
    return "uncertain";
  }

  function getVerdictLabel(verdict, language) {
    const code = normalizeVerdictCode(verdict);
    const labels = VERDICT_LABELS[language] || VERDICT_LABELS.en;
    return labels[code] || verdict || labels.uncertain;
  }

  function renderHistory(items, language) {
    historyList.innerHTML = "";
    if (!items.length) {
      noHistory.style.display = 'block';
      return;
    }
    noHistory.style.display = 'none';

    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'history-item';

      const verdictLabel = getVerdictLabel(item.verdict, language);
      const badgeClass = `badge-${normalizeVerdictCode(item.verdict)}`;

      const date = new Date(item.timestamp).toLocaleString();
      const contentSnippet = item.type === 'text'
        ? `"${item.content}"`
        : `[Image] ${item.content}`;

      div.innerHTML = `
        <div class="item-header">
          <span class="item-badge ${badgeClass}">${verdictLabel}</span>
          <span class="item-time">${date}</span>
        </div>
        <div class="item-content" title="${item.content}">${contentSnippet}</div>
        <div class="item-explanation">${item.explanation || ""}</div>
      `;
      historyList.appendChild(div);
    });
  }

  chrome.storage.sync.get({
    backendBaseUrl: DEFAULT_BACKEND_BASE_URL,
    languageMode: DEFAULT_LANGUAGE_MODE,
    lowBandwidth: false
  }, (data) => {
    const uiLanguage = resolveUiLanguage(data.languageMode);
    applyTranslations(uiLanguage);
    languageModeSelect.value = data.languageMode || DEFAULT_LANGUAGE_MODE;
    lowBandwidthToggle.checked = Boolean(data.lowBandwidth);
    backendUrlInput.value = normalizeBaseUrl(data.backendBaseUrl);

    chrome.storage.local.get({ history: [] }, (historyData) => {
      historyCache = historyData.history || [];
      renderHistory(historyCache, uiLanguage);
    });
  });

  function saveBackendUrl() {
    const normalized = normalizeBaseUrl(backendUrlInput.value);
    chrome.storage.sync.set({ backendBaseUrl: normalized }, () => {
      backendUrlInput.value = normalized;
      setStatusSaved();
    });
  }

  function saveSettings() {
    const languageMode = languageModeSelect.value || DEFAULT_LANGUAGE_MODE;
    const lowBandwidth = Boolean(lowBandwidthToggle.checked);
    chrome.storage.sync.set({ languageMode, lowBandwidth }, () => {
      const uiLanguage = resolveUiLanguage(languageMode);
      applyTranslations(uiLanguage);
      renderHistory(historyCache, uiLanguage);
      setStatusSaved();
    });
  }

  saveBackendUrlButton.addEventListener('click', saveBackendUrl);
  backendUrlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveBackendUrl();
  });
  languageModeSelect.addEventListener('change', saveSettings);
  lowBandwidthToggle.addEventListener('change', saveSettings);
});
