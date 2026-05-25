# Misinfo Detector — AI-Powered Fact-Checking Chrome Extension

A lightweight Chrome Extension (Manifest V3) that lets you **right-click any text or image** on the web and instantly fact-check it using **Claude AI** with live web search.

---

##  Features

- **Verify Claim** — Highlight text → Right-click → Fact-check against live web sources
- **Verify Image** — Right-click any image → Claude Vision extracts all details → web searched and verified
- **Bangla/Bengali Support** — Preserves Bengali Unicode script during extraction and analysis
- **Satirical Detection** — Memes and satire are identified immediately without unnecessary searching
- **Verdict Badges**
  - 🟢 **Likely True** — Confirmed by reliable sources
  - 🔴 **Likely False** — Contradicted or out of context
  - 🟡 **Uncertain** — Insufficient evidence
  - 🟣 **Satirical** — Identified as satire or meme content
- **History** — Last 10 checks cached locally via `chrome.storage`

---

##  Architecture

```
v002/
├── manifest.json        # Chrome Extension Manifest V3
├── background.js        # Service worker: context menus, image download, backend relay
├── content.js           # Injected floating result UI
├── content.css          # Dark-theme styles for injected UI
├── popup.html/js/css    # Extension toolbar popup (history)
├── icon.png
└── backend/
    ├── server.js        # Node.js/Express backend
    ├── package.json
    └── .env.example     # Copy to .env and add your API key
```

### How It Works

| Step | What happens |
|------|-------------|
| 1 | User right-clicks text/image → Chrome extension captures it |
| 2 | For images: Claude Vision extracts text, people, location, tone, key claim |
| 3 | Claude performs a targeted web search using the extracted info |
| 4 | Claude synthesizes search results → returns structured JSON verdict |
| 5 | Result displayed as a floating popup on the page |

---

##  Setup

### Prerequisites
- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/)
- Google Chrome

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
npm start
```

The backend will run at `http://localhost:3000`.

### 2. Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** and select the `v002/` folder
4. The extension icon will appear in your toolbar

### 3. Using It

- **Text:** Highlight any text on a webpage → Right-click → **Verify Claim**
- **Image:** Right-click any image → **Verify Image**
- **History:** Click the extension icon to see your last 10 checks

> ⚠️ The backend server must be running before using the extension.

---

## ⚙️ Configuration

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (required) |
| `PORT` | Backend port (default: `3000`) |

---

##  AI Pipeline

1. **Image Extraction** (`claude-sonnet-4-5`) — Vision analysis: visible text (Bengali-aware), people, location, tone, manipulation signals, key claim
2. **Web Search + Verdict** (`claude-sonnet-4-5` + `web_search_20250305` tool) — Targeted 2-step agentic loop: one web search → final JSON verdict

---

##  License

MIT
