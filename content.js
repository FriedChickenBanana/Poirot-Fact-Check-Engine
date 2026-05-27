chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "showLoading") {
    createOrUpdatePopup({ verdict: "Analyzing...", explanation: "Searching the web and checking facts...", loading: true });
  } else if (request.action === "showResult") {
    createOrUpdatePopup(request.result);
  }
});

function safeHostname(url) {
  try { return new URL(url).hostname; } catch { return url.substring(0, 40); }
}

function createOrUpdatePopup(data) {
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

  const content = document.getElementById("misinfo-content");

  let badgeClass = "badge-uncertain";
  if (data.verdict?.toLowerCase().includes("true"))      badgeClass = "badge-true";
  else if (data.verdict?.toLowerCase().includes("false")) badgeClass = "badge-false";
  else if (data.verdict?.toLowerCase().includes("satir")) badgeClass = "badge-satirical";
  else if (data.verdict?.toLowerCase().includes("error")) badgeClass = "badge-error";

  // Key findings bullets
  let findingsHtml = "";
  if (data.key_findings?.length > 0) {
    findingsHtml = `
      <div class="misinfo-findings">
        <strong>Key Findings:</strong>
        <ul>${data.key_findings.map(f => `<li>${f}</li>`).join('')}</ul>
      </div>`;
  }

  // Sources
  let sourcesHtml = "";
  if (data.sources?.length > 0) {
    sourcesHtml = `
      <div class="misinfo-sources">
        <strong>Sources:</strong>
        <ul>${data.sources.map(s => `<li><a href="${s}" target="_blank">${safeHostname(s)}</a></li>`).join('')}</ul>
      </div>`;
  }

  content.innerHTML = `
    <div class="misinfo-header">
      <span class="misinfo-badge ${badgeClass}">${data.verdict || "Uncertain"}</span>
      ${data.confidence ? `<span class="misinfo-confidence">${data.confidence}% confidence</span>` : ''}
    </div>
    <p class="misinfo-explanation">${data.explanation || ""}</p>
    ${findingsHtml}
    ${sourcesHtml}
    
    ${!data.loading && !data.isFeedback ? `
    <div class="misinfo-feedback" id="misinfo-feedback-section">
      <strong>Was this helpful?</strong>
      <button id="misinfo-thumb-up">👍 Yes</button>
      <button id="misinfo-thumb-down">👎 No</button>
      <div id="misinfo-feedback-form" style="display: none; margin-top: 10px;">
        <textarea id="misinfo-user-explanation" placeholder="Tell us why..." style="width:100%;"></textarea>
        <button id="misinfo-submit-feedback" style="margin-top:5px;">Submit Feedback</button>
      </div>
    </div>
    ` : ''}
  `;

  if (!data.loading && !data.isFeedback) {
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
      document.getElementById("misinfo-feedback-section").innerHTML = "<em>Feedback submitted. Thank you!</em>";
      
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
