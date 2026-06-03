// Track the latest requestId so only the most recent fact-check controls the UI.
// Without this, concurrent or rapid-fire fact-checks can cause a late "showLoading"
// from request B to overwrite the completed result of request A.
let _activeRequestId = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "showLoading") {
    _activeRequestId = request.requestId || null;
    createOrUpdatePopup({ verdict: "Analyzing...", explanation: "Poirot agents are checking facts...", loading: true });
  } else if (request.action === "showResult") {
    // Only render if this result matches the latest request (or if IDs aren't available)
    if (_activeRequestId && request.requestId && request.requestId !== _activeRequestId) {
      console.log("[Poirot] Ignoring stale result for request", request.requestId);
      return;
    }
    _activeRequestId = null;
    createOrUpdatePopup(request.result);
  }
});

function safeHostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url.substring(0, 40); }
}

function createOrUpdatePopup(data) {
  let container = document.getElementById("misinfo-detector-ui");
  if (!container) {
    container = document.createElement("div");
    container.id = "misinfo-detector-ui";
    
    // Add close button
    const closeBtn = document.createElement("button");
    closeBtn.className = "misinfo-close";
    closeBtn.innerText = "×";
    closeBtn.onclick = () => container.remove();
    container.appendChild(closeBtn);
    
    // Add brand header
    const brand = document.createElement("div");
    brand.className = "misinfo-brand";
    brand.innerHTML = `<span class="misinfo-brand-icon">🔍</span> POIROT <span class="misinfo-brand-badge">AI</span>`;
    container.appendChild(brand);

    const content = document.createElement("div");
    content.id = "misinfo-content";
    container.appendChild(content);
    
    document.body.appendChild(container);
  }

  const content = document.getElementById("misinfo-content");

  if (data.loading) {
    content.innerHTML = `
      <div style="text-align:center; padding: 20px 0;">
        <div class="misinfo-loading-spinner"></div>
        <div style="color: #9494a8; font-size: 14px;">${data.explanation}</div>
      </div>
    `;
    return;
  }

  let badgeClass = "badge-uncertain";
  if (data.verdict?.toLowerCase().includes("true")) badgeClass = "badge-true";
  else if (data.verdict?.toLowerCase().includes("false")) badgeClass = "badge-false";
  else if (data.verdict?.toLowerCase().includes("satir")) badgeClass = "badge-satirical";
  else if (data.verdict?.toLowerCase().includes("error")) badgeClass = "badge-error";

  // Metrics
  let metricsHtml = `
    <div class="misinfo-metrics">
      ${data.confidence ? `
      <div class="misinfo-metric">
        <span class="metric-label">Confidence</span>
        <span class="metric-value">${data.confidence}%</span>
      </div>` : ''}
      ${data.trust_score ? `
      <div class="misinfo-metric">
        <span class="metric-label">Trust</span>
        <span class="metric-value">${data.trust_score}%</span>
      </div>` : ''}
    </div>
  `;

  // Key findings bullets
  let findingsHtml = "";
  if (data.key_findings?.length > 0) {
    findingsHtml = `
      <div class="misinfo-findings">
        <div class="misinfo-section-title">Key Findings</div>
        <ul>${data.key_findings.map(f => `<li>${f}</li>`).join('')}</ul>
      </div>`;
  }

  // Reasoning chain (Chain-of-Thought steps from the verdict agent)
  let reasoningHtml = "";
  if (data.reasoning_chain?.length > 0) {
    reasoningHtml = `
      <div class="misinfo-findings">
        <div class="misinfo-section-title">🧩 Reasoning</div>
        <ol style="margin:0;padding-left:18px;">${data.reasoning_chain.map(s => `<li style="font-size:11px;color:#a0a0b8;margin-bottom:3px;">${s}</li>`).join('')}</ol>
      </div>`;
  }

  // Bias / framing flags
  let biasHtml = "";
  if (data.bias_flags?.length > 0) {
    biasHtml = `
      <div class="misinfo-findings" style="margin-top:8px;">
        <div class="misinfo-section-title" style="color:#f59e0b;">⚠️ Bias Flags</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
          ${data.bias_flags.map(b => `<span style="font-size:10px;background:rgba(245,158,11,0.12);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:2px 8px;">${String(b).replace(/_/g, ' ')}</span>`).join('')}
        </div>
      </div>`;
  }

  // Sources
  let sourcesHtml = "";
  if (data.sources?.length > 0) {
    sourcesHtml = `
      <div class="misinfo-sources">
        <div class="misinfo-section-title">Sources</div>
        <ul>${data.sources.map(s => `<li><a href="${s}" target="_blank">${safeHostname(s)}</a></li>`).join('')}</ul>
      </div>`;
  }

  // Deepfake forensics section removed — image fact-checking now focuses on
  // verifying the informational content of images, not pixel-level manipulation.
  let deepfakeHtml = "";

  // Digital literacy tip
  let literacyHtml = "";
  if (data.literacy_tip) {
    literacyHtml = `
      <div style="background:rgba(99,102,241,0.08);border-left:3px solid #6366f1;border-radius:4px;padding:8px 10px;margin-top:8px;">
        <div class="misinfo-section-title" style="color:#6366f1;margin-bottom:4px;">💡 Literacy Tip</div>
        <p style="font-size:11px;color:#a0a0b8;margin:0;line-height:1.5;">${data.literacy_tip}</p>
      </div>`;
  }

  // Meta (latency, tokens, agents)
  let metaHtml = "";
  const metaParts = [];
  if (data.agents_used) metaParts.push(`🤖 ${data.agents_used.length} Agents`);
  if (data.latency_ms) metaParts.push(`⚡ ${(data.latency_ms / 1000).toFixed(1)}s`);
  if (data.tokens_used) metaParts.push(`🪙 ${data.tokens_used} tok`);
  if (data.language) metaParts.push(`🌐 ${data.language.toUpperCase()}`);
  if (metaParts.length > 0) {
    metaHtml = `<div class="misinfo-meta">${metaParts.join(' • ')}</div>`;
  }

  content.innerHTML = `
    <div class="misinfo-header">
      <span class="misinfo-badge ${badgeClass}">${data.verdict || "Uncertain"}</span>
      ${metricsHtml}
    </div>
    <p class="misinfo-explanation">${data.explanation || ""}</p>
    ${findingsHtml}
    ${reasoningHtml}
    ${biasHtml}
    ${sourcesHtml}
    ${deepfakeHtml}
    ${literacyHtml}
    ${metaHtml}
    
    ${!data.isFeedback ? `
    <div class="misinfo-feedback" id="misinfo-feedback-section">
      <strong>Was this analysis helpful?</strong>
      <div style="display:flex;">
        <button id="misinfo-thumb-up">👍 Yes</button>
        <button id="misinfo-thumb-down">👎 No</button>
      </div>
      <div id="misinfo-feedback-form" style="display: none; margin-top: 16px;">
        <textarea id="misinfo-user-explanation" placeholder="Tell us why..."></textarea>
        <button id="misinfo-submit-feedback">Submit Feedback</button>
      </div>
    </div>
    ` : ''}
  `;

  if (!data.isFeedback) {
    let isPositive = null;
    const btnUp = document.getElementById("misinfo-thumb-up");
    const btnDown = document.getElementById("misinfo-thumb-down");
    const form = document.getElementById("misinfo-feedback-form");

    btnUp.onclick = () => {
      isPositive = true;
      btnUp.classList.add('active-up');
      btnDown.classList.remove('active-down');
      form.style.display = "block";
    };
    btnDown.onclick = () => {
      isPositive = false;
      btnDown.classList.add('active-down');
      btnUp.classList.remove('active-up');
      form.style.display = "block";
    };
    
    document.getElementById("misinfo-submit-feedback").onclick = async () => {
      const userText = document.getElementById("misinfo-user-explanation").value;
      document.getElementById("misinfo-feedback-section").innerHTML = `
        <div style="text-align:center; padding: 10px 0;">
          <span style="font-size: 24px; display:block; margin-bottom:8px;">✅</span>
          <span style="color:#22c55e; font-size: 13px; font-weight:600;">Feedback submitted. Thank you!</span>
        </div>
      `;
      
      const payload = {
        type: data.originalType || "text",
        content: data.originalContent || "",
        requestId: data.requestId || "",
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
