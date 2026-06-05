# Poirot Fact-Check Engine — Enterprise AI Architecture

Poirot is an AI-native, multi-agent fact-checking engine built to protect information integrity in Bangladesh and globally. Originally a Chrome extension, it has evolved into a robust API and analytics platform powered by a 5-agent AI pipeline, RAG knowledge graph, and Neo4j-inspired trust scoring.

---

## 🌟 Key Features

- **Multi-Agent Pipeline**: Cost-optimized architecture using Haiku for preprocessing and Sonnet for final web-search verdicts.
- **RAG + Vector Search**: PGVector-powered semantic search over verified facts and known misinformation patterns.
- **Trust Scoring System**: PostgreSQL-based credibility graph weighting source history, cross-references, and temporal consistency.
- **Bangla-First UX**: Full Bengali language support in both the UI and AI reasoning.
- **Real-Time Analytics Dashboard**: Live monitoring of misinformation trends and source credibility leaderboards.
- **Enterprise API**: Tiered API access with rate-limiting for B2B integrations.

---

## 🛠️ Architecture

Poirot follows a modern, scalable, and cost-effective AI architecture:

1.  **Chrome Extension (Frontend)**: Manifest V3 extension (vanilla JS) capturing claims/images and displaying contextual UI.
2.  **Verification Web App (Frontend)**: React 19 + Vite + Tailwind v4 single-page "Verification Console" in [`frontend/`](frontend/) — text / image / social-link checks with an EN/BN UI and text-to-speech. Talks to the backend over `POST /verify`.
3.  **Analytics Dashboard (Frontend)**: Real-time analytics built with HTML/CSS/JS (vanilla) and Chart.js, served by the backend at `/`.
4.  **Express Backend**: Node.js API orchestrating agents, managing database connections, and serving the dashboard.
5.  **Database Layer (Neon DB)**: PostgreSQL 15+ utilizing PGVector for RAG and complex recursive queries for Trust Scoring.
6.  **Caching & Rate Limiting (Redis/Upstash)**: Upstash Redis for response caching and tiered API rate limiting.

### The 5-Agent Pipeline

To minimize costs while maintaining high accuracy, Poirot routes tasks to the most efficient model:

1.  **Classifier (Haiku 4.5)**: Language detection, categorization, and early satire detection. (~$0.0002/call)
2.  **Extractor (Haiku 4.5 Vision)**: Extracts text, tone, and metadata from images. (~$0.001/call)
3.  **Decomposer (Haiku 4.5)**: Breaks complex claims into verifiable sub-claims. (~$0.0003/call)
4.  **Verdict Engine (Haiku 4.5 + web search)**: The core engine. Runs one web search and synthesizes the final verdict from web + RAG/GraphRAG context, with inline source-bias flags. Defaults to Haiku for cost/latency (keeps the round-trip under the extension's ~30s limit); a strong Google Fact Check match skips web search entirely.
5.  **Bias Flags (inline)**: Source bias and framing flags are produced directly by the Verdict Engine — no separate model call — keeping latency and cost down.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- [Anthropic API Key](https://console.anthropic.com/)
- [Neon DB](https://neon.tech/) (PostgreSQL with PGVector)
- [Upstash Redis](https://upstash.com/) (or local Redis)
- [Cloudinary](https://cloudinary.com/) (for image feedback storage)
- [Google Fact Check Tools API Key](https://developers.google.com/fact-check/tools/api) (Optional but recommended)
- [Voyage AI Key](https://www.voyageai.com/) (Optional — `voyage-3` embeddings for semantic RAG; falls back to a zero-cost hash vector if unset)

### 1. Database Setup
Execute the full schema migration in your Neon DB SQL Editor:
```bash
cat backend/db/migrations/001_full_schema.sql
# Copy and run in Neon
```

### 2. Backend Setup
```bash
cd backend
npm install
cp .env.example .env
```
Fill in your `.env` variables (Database URL, Redis URL, API Keys).

Start the server:
```bash
npm run dev
```
The dashboard will be available at `http://localhost:3000`.

note : The backend is now hosted and these steps are only required if you want to run the backend locally. If you do want to run the backend locally, change base URL in extension/background.js to `http://localhost:3000`.

### 3. Extension Setup
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the extension folder.

### 4. Web App (SPA) Setup
The React verification console lives in [`frontend/`](frontend/) and is fully decoupled from the backend (it only calls `POST /verify`).
```bash
cd frontend
npm install
echo "VITE_BACKEND_BASE_URL=http://localhost:3000" > .env   # defaults to localhost:3000 if unset
npm run dev      # dev server at http://localhost:5173
npm run build    # production build → frontend/dist (deploy as static files)
```
Set `VITE_BACKEND_BASE_URL` to your deployed backend for production builds. The backend CORS allowlist already permits `localhost`, `ngrok`, and `onrender.com` origins.

---

## 📊 Analytics Dashboard

Access the public dashboard at the root URL (e.g., `http://localhost:3000/`) to view:
- Verdict distributions
- Verification trends
- Source credibility leaderboards
- Anonymized recent verifications

---

## 🔌 Enterprise API

Poirot offers a RESTful API for integrating fact-checking into platforms.

**Endpoint**: `POST /api/v1/verify`
**Headers**: `x-api-key: YOUR_KEY`

**Request Body**:
```json
{
  "type": "text",
  "content": "A recent claim to verify..."
}
```

**Response**:
```json
{
  "verdict": "Likely False",
  "confidence": 92,
  "trust_score": 78,
  "explanation": "Explanation based on web evidence...",
  "key_findings": ["Finding 1"],
  "sources": ["https://source.com"],
  "agents_used": ["classifier", "verdict_synthesizer"],
  "tokens_used": 1500,
  "latency_ms": 4200
}
```

### Internal `/verify` contract (Extension + Web App)
The `POST /verify` route used by the extension and the React web app accepts a few extra fields beyond the enterprise endpoint:

- **Request**: `type` is one of `text` | `image` | `social-media`; optional `language` (`en` | `bn` | `auto`) steers the verdict's output language; `base64` for images; `url` for social links.
- **`social-media`**: a pasted X / Facebook / Instagram / TikTok / YouTube / Reddit / LinkedIn / Threads URL is scraped (auth-free oEmbed/`.json` first, then Open Graph) into a text claim, then verified. Best-effort — on failure it returns a clean `Uncertain`, never a raw-URL check.
- **Response**: adds `verdict_code` (`true` | `false` | `uncertain` | `satirical` | `error`) for UI colour-coding / text-to-speech, plus `trust_score`, `bias_flags`, `reasoning_chain`, and `literacy_tip`.

---

## 🏆 BuildFest '26 Alignment

Poirot was significantly upgraded for the Infinity AI BuildFest 2026 (Track 5: InfoTech).
- **Innovation**: Token-optimized 5-agent architecture.
- **Technical Execution**: PGVector RAG + PostgreSQL Trust Graph.
- **Business Model**: Enterprise API tiers + Rate Limiting.
- **Impact**: Public real-time dashboard + Analytics.
- **Localization**: Full Bangla support.

---

## 📄 License

MIT
