const I18N = {
  en: {
    loadingVerdict: "Analyzing...",
    loadingExplanation: "Searching the web and checking facts...",
    keyFindings: "Key Findings:",
    sources: "Sources:",
    feedbackPrompt: "Was this helpful?",
    feedbackYes: "Yes",
    feedbackNo: "No",
    feedbackPlaceholder: "Tell us why...",
    feedbackSubmit: "Submit Feedback",
    feedbackThanks: "Feedback submitted. Thank you!",
    confidence: "confidence",
    verdictTrue: "Likely True",
    verdictFalse: "Likely False",
    verdictUncertain: "Uncertain",
    verdictSatirical: "Satirical",
    verdictError: "Error"
  },
  bn: {
    loadingVerdict: "বিশ্লেষণ চলছে...",
    loadingExplanation: "ওয়েব অনুসন্ধান ও তথ্য যাচাই করা হচ্ছে...",
    keyFindings: "মূল তথ্য:",
    sources: "উৎসসমূহ:",
    feedbackPrompt: "এটি কি সহায়ক ছিল?",
    feedbackYes: "হ্যাঁ",
    feedbackNo: "না",
    feedbackPlaceholder: "কারণ জানান...",
    feedbackSubmit: "ফিডব্যাক পাঠান",
    feedbackThanks: "ফিডব্যাক পেয়েছি। ধন্যবাদ!",
    confidence: "বিশ্বাসযোগ্যতা",
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

function resolveUiLanguage(value) {
  return value === "bn" ? "bn" : "en";
}

function t(language, key) {
  const dict = I18N[language] || I18N.en;
  return dict[key] || I18N.en[key] || "";
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

function getVerdictLabel(language, code, fallback) {
  const labels = VERDICT_LABELS[language] || VERDICT_LABELS.en;
  return labels[code] || fallback || labels.uncertain;
}

function formatConfidence(language, value) {
  if (value === null || value === undefined || value === "") return "";
  return `${value}% ${t(language, "confidence")}`;
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "showLoading") {
    const uiLanguage = resolveUiLanguage(request.uiLanguage);
    createOrUpdatePopup({
      verdict: t(uiLanguage, "loadingVerdict"),
      explanation: t(uiLanguage, "loadingExplanation"),
      loading: true,
      uiLanguage,
      lowBandwidth: request.lowBandwidth
    });
  } else if (request.action === "showResult") {
    createOrUpdatePopup(request.result);
  }
});

function safeHostname(url) {
  try { return new URL(url).hostname; } catch { return url.substring(0, 40); }
}

function createOrUpdatePopup(data) {
  const uiLanguage = resolveUiLanguage(data.uiLanguage || data.language);
  const isLowBandwidth = Boolean(data.lowBandwidth);

  let container = document.getElementById("misinfo-detector-ui");
  if (!container) {
    container = document.createElement("div");
    container.id = "misinfo-detector-ui";
    const closeBtn = document.createElement("button");
    closeBtn.className = "misinfo-close";
    closeBtn.innerText = "×";
    closeBtn.onclick = () => container.remove();
    container.appendChild(closeBtn);
    const content = document.createElement("div");
    content.id = "misinfo-content";
    container.appendChild(content);
    document.body.appendChild(container);
  }

  container.classList.toggle("misinfo-compact", isLowBandwidth);

  const content = document.getElementById("misinfo-content");

  const verdictCode = data.loading
    ? "uncertain"
    : normalizeVerdictCode(data.verdict_code || data.verdict);

  let badgeClass = "badge-uncertain";
  if (verdictCode === "true") badgeClass = "badge-true";
  else if (verdictCode === "false") badgeClass = "badge-false";
  else if (verdictCode === "satirical") badgeClass = "badge-satirical";
  else if (verdictCode === "error") badgeClass = "badge-error";

  const verdictLabel = data.loading
    ? t(uiLanguage, "loadingVerdict")
    : getVerdictLabel(uiLanguage, verdictCode, data.verdict);

  // Key findings bullets
  let findingsHtml = "";
  if (!isLowBandwidth && data.key_findings?.length > 0) {
    findingsHtml = `
      <div class="misinfo-findings">
        <strong>${t(uiLanguage, "keyFindings")}</strong>
        <ul>${data.key_findings.map(f => `<li>${f}</li>`).join('')}</ul>
      </div>`;
  }

  // Sources
  let sourcesHtml = "";
  if (!isLowBandwidth && data.sources?.length > 0) {
    sourcesHtml = `
      <div class="misinfo-sources">
        <strong>${t(uiLanguage, "sources")}</strong>
        <ul>${data.sources.map(s => `<li><a href="${s}" target="_blank">${safeHostname(s)}</a></li>`).join('')}</ul>
      </div>`;
  }

  content.innerHTML = `
    <div class="misinfo-header">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span class="misinfo-badge ${badgeClass}">${verdictLabel}</span>
        ${data.confidence !== undefined && data.confidence !== null ? `<span class="misinfo-confidence">${formatConfidence(uiLanguage, data.confidence)}</span>` : ''}
      </div>
      ${!data.loading ? `<button class="misinfo-speak" id="misinfo-speak" aria-label="${t(uiLanguage, "speak")}" title="${t(uiLanguage, "speak")}">🔊</button>` : ''}
    </div>
    <p class="misinfo-explanation">${data.explanation || ""}</p>
    ${findingsHtml}
    ${sourcesHtml}
    
    ${!data.loading && !data.isFeedback ? `
    <div class="misinfo-feedback" id="misinfo-feedback-section">
      <strong>${t(uiLanguage, "feedbackPrompt")}</strong>
      <button id="misinfo-thumb-up">👍 ${t(uiLanguage, "feedbackYes")}</button>
      <button id="misinfo-thumb-down">👎 ${t(uiLanguage, "feedbackNo")}</button>
      <div id="misinfo-feedback-form" style="display: none; margin-top: 10px;">
        <textarea id="misinfo-user-explanation" placeholder="${t(uiLanguage, "feedbackPlaceholder")}" style="width:100%;"></textarea>
        <button id="misinfo-submit-feedback" style="margin-top:5px;">${t(uiLanguage, "feedbackSubmit")}</button>
      </div>
    </div>
    ` : ''}
  `;

  if (!data.loading && !data.isFeedback) {
    const speakButton = document.getElementById("misinfo-speak");
    if (speakButton) {
      speakButton.onclick = () => speakVerdict(uiLanguage, verdictCode);
    }

    let isPositive = null;
    document.getElementById("misinfo-thumb-up").onclick = () => {
      isPositive = true;
      document.getElementById("misinfo-feedback-form").style.display = "block";
    };
    document.getElementById("misinfo-thumb-down").onclick = () => {
      isPositive = false;
      document.getElementById("misinfo-feedback-form").style.display = "block";
    };
    document.getElementById("misinfo-submit-feedback").onclick = async () => {
      const userText = document.getElementById("misinfo-user-explanation").value;
      document.getElementById("misinfo-feedback-section").innerHTML = `<em>${t(uiLanguage, "feedbackThanks")}</em>`;
      
      const payload = {
        type: data.originalType || "text",
        content: data.originalContent || "",
        base64: data.originalBase64 || "",
        verdict: data.verdict,
        explanation: data.explanation,
        feedbackIsPositive: isPositive,
        userExplanation: userText
      };

      try {
        chrome.runtime.sendMessage({ action: "submitFeedback", payload });
      } catch (err) {
        console.error("Feedback error", err);
      }
    };
  }
}
