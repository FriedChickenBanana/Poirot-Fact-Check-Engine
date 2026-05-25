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
  `;
}
