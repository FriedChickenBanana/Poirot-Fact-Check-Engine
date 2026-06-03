# Poirot — Codebase Comparison & Migration Notes

Comparison of **this project** (working directory) against the reference repo
`https://github.com/FriedChickenBanana/Poirot-Fact-Check-Engine.git`
(cloned to `/tmp/reference-repo`, default branch, shallow clone on 2026-06-04).

> Note on provenance: the reference repo is under the **same GitHub owner**
> (`FriedChickenBanana`) as this project's history (see this repo's merge commit
> `e2e68a0 … FriedChickenBanana/Shafnan`). It may well be your own team's repo.
> Everything below is based only on files actually read; paths are cited.

Throughout: **"Mine"** = this working directory. **"Theirs"** = `/tmp/reference-repo`.

---

## 1. Backend comparison

### 1.1 Structural differences

| Aspect | Theirs (`/tmp/reference-repo/backend`) | Mine (`backend/`) |
|---|---|---|
| Pipeline | Single-file procedural flow in [`controllers/verifyController.js`](backend/controllers/verifyController.js) | Multi-agent [`services/agentOrchestrator.js`](backend/services/agentOrchestrator.js) (classify → extract → decompose → route → verdict) |
| Routes | 2 only: `/verify`, `/feedback` (`routes/verifyRoutes.js`, `routes/feedbackRoutes.js`) | 4 groups: `/verify`, `/feedback`, `/api/dashboard`, `/api/v1` ([`server.js`](backend/server.js)) |
| Data layer | Postgres `user_feedback` only (`backend/db/schema.sql`) + Redis cache | pgvector RAG, GraphRAG (entities/relationships), trust/source profiles, verification_log, trending MV, api_keys ([`db/migrations/001_full_schema.sql`](backend/db/migrations/001_full_schema.sql)) |
| Retrieval/AI | Google Fact Check + Anthropic `web_search` only | + RAG ([`services/ragService.js`](backend/services/ragService.js)), GraphRAG ([`services/graphRagService.js`](backend/services/graphRagService.js)), trust scoring, analytics, RSS scraper |
| Model | Sonnet 4.5 hardcoded (`backend/services/anthropicService.js`) | Haiku/Sonnet tiers + routing ([`services/agentOrchestrator.js`](backend/services/agentOrchestrator.js)) |
| Auth / limits | None; open `cors()` | API-key middleware ([`middleware/apiAuth.js`](backend/middleware/apiAuth.js)), rate limiter ([`middleware/rateLimiter.js`](backend/middleware/rateLimiter.js)), CORS allowlist + in-memory IP limiter ([`server.js`](backend/server.js)) |
| Perf/ops | None | `compression()`, static dashboard hosting, hourly MV refresh, 6-hourly scraper seeding ([`server.js`](backend/server.js)) |
| Feedback | Cloudinary + `user_feedback` insert | **Identical** logic ([`controllers/feedbackController.js`](backend/controllers/feedbackController.js) is byte-for-byte the same) |

**Net:** my backend is a strict superset in capability. Theirs is a leaner, single-path version of the same project at an earlier stage — but it carries a few **request/response and feature conventions** that my backend lacks and that their frontend depends on (see 1.2).

### 1.2 Things their backend does that mine doesn't

For each: value, and effort (🟢 easy drop-in / 🟡 moderate / 🔴 refactor).

1. **`verdict_code` normalization** — `normalizeVerdictCode()` maps any verdict (EN or BN) to a machine code `true|false|uncertain|satirical|error` (`backend/controllers/verifyController.js`). Their frontend keys color + text-to-speech off this.
   - **Take:** Worth adopting — it's the contract their UI expects. 🟢 Easy: add the helper and set `result.verdict_code` in my [`controllers/verifyController.js`](backend/controllers/verifyController.js) after the orchestrator returns. No orchestrator change needed.

2. **Request-driven language (`language`/`uiLanguage`) + strict Bangla enforcement** — `enforceBanglaOutput()` / `isBanglaText()` force BN responses to actually be Bangla, else return an Uncertain fallback (`backend/controllers/verifyController.js`; prompt side in `backend/services/anthropicService.js` `buildVerdictSystem`).
   - **Take:** Worth adopting for BN quality and to honor a UI language selector. My orchestrator already has a `language` notion but auto-detects rather than accepting an explicit override. 🟡 Moderate: thread a `language` param from the request through `orchestrate()` into the verdict prompt, then run `enforceBanglaOutput` in the controller.

3. **Social-media link extraction** — `socialMediaService.extractFromSocialMedia()` fetches a pasted X/Facebook/Instagram/TikTok/YouTube URL and scrapes claim text via `og:` meta / regex (`backend/services/socialMediaService.js`), wired through a `type: 'social-media'` branch.
   - **Take:** Genuinely new capability I lack, and their frontend offers it. But it's **fragile** (HTML regex; most platforms block server scraping / require auth). 🟡 Moderate to wire in; 🔴 to make reliable. Adopt as best-effort with graceful fallback; don't promise reliability.

4. **`lowBandwidth` flag + language in the cache key** — `cacheService.cacheKey()` includes `language` and `lowBandwidth` so EN/BN variants cache separately (`backend/services/cacheService.js`, 24h TTL).
   - **Take:** The language dimension is worth it once I serve BN/EN from one backend (otherwise cache cross-contaminates languages). `lowBandwidth` is only meaningful if I implement a lighter response — low priority. 🟢 Easy for the cache-key change.

5. **`Satirical` as a first-class verdict value** in the verdict schema (`backend/services/anthropicService.js` `buildVerdictSystem`). Mine handles satire only via an early-exit branch in the orchestrator, so the verdict agent itself can't emit "Satirical".
   - **Take:** Minor. My early-exit already covers most cases. 🟢 Easy if I want parity (add to the enum in my verdict prompt).

### 1.3 What I should NOT adopt from their backend

- **Their monolithic `verifyController.js`** — it inlines classification, prompt building, parsing, and language logic in one ~300-line file, and **literally defines the same functions twice** (`normalizeLanguage`, `normalizeVerdictCode`, `containsBengali`, `isBanglaText`, `enforceBanglaOutput`, `buildJsonOnlyInstructions` each appear twice in `backend/controllers/verifyController.js`). My orchestrator architecture is cleaner and more capable — keep mine; cherry-pick helpers only.
- **Open `cors()`** (`backend/server.js`) — mine has an origin allowlist; keep mine.
- **No rate limiting** — mine has IP + key limiting; keep mine.
- **Hardcoded Sonnet 4.5** — mine routes to Haiku for cost/latency; keep mine.
- **`@tavily/core` dependency** — declared in `backend/package.json` but **not imported anywhere** in their code I read; it's a dead dep. Don't copy it.
- **Don't let a port regress my advanced layers** (RAG/GraphRAG/trust/analytics). Their absence of these is "earlier stage," not "better."

---

## 2. Frontend stack & structure (their React app)

> Important framing: their `frontend/` is a **standalone React web SPA**, separate
> from the Chrome extension (the extension at their repo root is still vanilla
> `popup.html`/`background.js`, like mine). "Rebuilding my frontend to look like
> theirs" means **creating a new Vite React SPA**, not modifying my extension.

### 2.1 Exact stack
- **Framework:** React **19** (`frontend/package.json`: `react`/`react-dom` ^19.2).
- **Build tool:** **Vite 8** with `@vitejs/plugin-react` (`frontend/vite.config.js`).
- **Styling:** **Tailwind CSS v4** via the `@tailwindcss/vite` plugin + `@import "tailwindcss";` in `frontend/src/index.css`. No `tailwind.config.js` (v4 is config-less by default). Styling is **utility classes inline** in JSX plus a small global stylesheet.
- **Component library:** **None** (hand-rolled elements).
- **State management:** **None** beyond React hooks — `useState`, `useRef`, `useMemo` in `frontend/src/App.jsx`.
- **Routing:** **None** — single page, single component.
- **i18n:** custom, not a library — a plain dictionary + helpers in `frontend/src/i18n.js` (EN/BN).
- **Lint:** ESLint flat config (`frontend/eslint.config.js`).

### 2.2 Folder / component structure
```
frontend/
├── index.html              # mounts #root, loads /src/main.jsx, title "Poirot : Fact Checking Engine"
├── vite.config.js          # react() + tailwindcss() plugins
├── eslint.config.js
├── package.json
├── public/                 # icon.png, favicon.svg, icons.svg
└── src/
    ├── main.jsx            # ReactDOM root; imports ./index.css and <App/>
    ├── App.jsx             # ENTIRE UI — one 426-line component
    ├── i18n.js             # I18N dict (en/bn), t(), VOICE_PHRASES, speakVerdict() (Web Speech API),
    │                       #   normalizeVerdictCode(), isSocialMediaLink(), isValidUrl()
    ├── index.css           # Tailwind import + IBM Plex fonts + dark grid background (40 lines)
    └── App.css             # DEAD: Vite starter leftover, NOT imported anywhere
```
- **Single component (`App.jsx`)** renders a **chat-style "Verification Console"**: a `messages[]` array of user/assistant bubbles; assistant messages can be `system | loading | result | error`. A `result` bubble shows verdict (color-coded), confidence %, key findings list, sources list, and a 🔊 TTS button. Input row = textarea + image upload (with preview) + submit. Header has a language `<select>` (Auto/EN/BN).

### 2.3 Styling & theming
- **Aesthetic:** stark **black/white "protocol"** look — `bg-black text-white`, hairline borders (`border-white/15`–`/30`), **no rounded corners** (square), **UPPERCASE** micro-labels with wide letter-spacing (`tracking-[0.3em]`).
- **Fonts (`frontend/src/index.css`):** **IBM Plex Sans** (body) + **IBM Plex Serif** (headings), loaded from Google Fonts. Background is `#050505` with a faint **grid** via layered `linear-gradient` (`background-size: 40px 40px`). Custom `::selection` colors.
- **Design tokens:** no formal token system — Tailwind utilities carry it. The only "tokens" are the font stack + grid background in `index.css`. Verdict colors live in `App.jsx` `verdictTone()`: true→`emerald-300`, false→`red-400`, satirical→`purple-300`, uncertain→`yellow-300`.

### 2.4 How their frontend talks to the backend
- Raw `fetch` (no axios/react-query). `POST {VITE_BACKEND_BASE_URL}/verify`, default `https://poirot-fact-check-engine.onrender.com` (`frontend/src/App.jsx`).
- Payload by type: `{type:'text', content, language}` / `{type:'image', content, base64, language}` / `{type:'social-media', content:url, url, language}`.
- Reads back `verdict`, `confidence`, `explanation`, `key_findings`, `sources`; recomputes `verdict_code` client-side via `normalizeVerdictCode()`. **TTS** uses the browser `speechSynthesis` API keyed on `verdict_code`.

### 2.5 Compatibility assessment vs my current frontend
- **My current frontend is 100% vanilla** — Chrome extension (`popup.js`/`popup.html`/`background.js`/`content.js`) + a vanilla dashboard (`dashboard/app.js`, `dashboard/index.html`, `dashboard/styles.css`). **No React, no Vite, no Tailwind, no build step.** My root `package.json` only has `nodemon`.
- **Therefore theirs cannot be "ported" into my stack — matching their look is a greenfield React+Vite+Tailwind app.** The good news: their UI is *self-contained* (one component + one i18n file + ~40 lines of CSS), so reproducing it is mechanical, not architectural.
- **Effort:**
  - Stand up Vite React + Tailwind v4 SPA and reproduce `App.jsx`/`i18n.js`/`index.css`: **low–moderate** (~half a day), since it's three files with no exotic deps.
  - **Backend response-shape compatibility is the real work:** their UI needs `verdict_code`, request `language`, and the `social-media` type. Without §1.2 items 1–3, the UI renders but loses color coding/TTS/BN/social features. **Moderate.**
  - Deciding the extension's fate (keep vanilla vs. rebuild on React) is separate — see 3.
- **My existing dashboard** is unrelated to their console UI; it can stay or later fold into the new SPA as a route.

### 2.6 License check (relevant to reusing their frontend)
- **No `LICENSE`/`COPYING` file exists** anywhere in the reference repo (verified).
- **However `README.md:133-135` states "## License — MIT".**
- **Honest read:** a README line is a strong *signal of intent* to license under MIT, but with **no actual LICENSE file the grant is legally weak/ambiguous**. MIT also requires preserving a copyright + permission notice — there's none to carry over. Practically, since it's the **same owner** as this project, reuse is likely fine in spirit. **Recommendation:** before copying code verbatim, either (a) confirm it's your own/team's repo, or (b) add a proper MIT `LICENSE` file to the reference repo so the MIT statement is real. Safest path regardless: treat their frontend as a **reference to reimplement** (the design/structure), which avoids notice-preservation issues entirely.

---

## 3. Recommended migration plan (staged — no edits yet)

Goal: rebuild the frontend to match theirs **without regressing my richer backend.**

### Phase 0 — Decisions & guardrails (before any code)
- Confirm reuse rights (see 2.6).
- Decide: **new `frontend/` SPA only**, leaving the Chrome extension vanilla (mirrors their repo), vs. also rebuilding the extension UI in React (more work). Recommend **SPA first**.
- Branch off `lucius`; keep backend changes additive.

### Phase 1 — Backend compatibility shims (low risk, do first)
Make my `/verify` speak the contract their UI expects, *without touching the orchestrator's core*:
1. Add `verdict_code` (§1.2 #1) in [`controllers/verifyController.js`](backend/controllers/verifyController.js).
2. Accept request `language`/`uiLanguage`; thread into the verdict prompt; add `enforceBanglaOutput` (§1.2 #2).
3. Add `language` to the cache key (§1.2 #4).
- **Test:** `curl` `/verify` with `{language:'bn'}` and `{language:'en'}` → confirm `verdict_code` present and BN responses are actually Bangla; confirm EN/BN cache separately.
- **Risk:** low. Keep changes in the controller; do not alter RAG/GraphRAG/routing.

### Phase 2 — Stand up the React SPA (greenfield)
4. Create `frontend/` with Vite + React 19 + `@tailwindcss/vite`.
5. Recreate `src/index.css` (fonts + grid), `src/i18n.js`, `src/App.jsx` (reimplement the console), `public/icon.png`.
6. Point `VITE_BACKEND_BASE_URL` at my backend (localhost during dev).
- **Test:** `npm run dev`; verify text claim, image upload, language switch, and that verdict colors + TTS work against my Phase-1 backend.
- **Risk:** low–moderate. Main pitfall: CORS — my allowlist in [`server.js`](backend/server.js) already permits `localhost`/`onrender.com`; add the SPA's dev origin if needed.

### Phase 3 — Optional new feature: social-media links (do last; isolated)
7. Add `services/socialMediaService.js` + a `type:'social-media'` branch (§1.2 #3), with graceful fallback to "couldn't extract."
- **Test:** a public X/FB URL end-to-end; confirm failures degrade to a clean error, not a crash.
- **Risk:** moderate — **the riskiest functional part** (third-party HTML scraping is brittle and may be rate-limited/blocked). Gate it behind the existing try/catch and never let it throw uncaught.

### Phase 4 — Consolidate & cut over
8. Decide dashboard's future (keep vanilla `dashboard/` or fold into the SPA as a route).
9. Update README/deploy (Vite build → static host; backend stays on Render/localhost).
- **Test:** full regression — extension still works (unchanged), SPA works, dashboard works, BN/EN both correct.

**Where the risk concentrates:** Phase 1 #2 (language threading touches the prompt path — verify it doesn't change EN behavior) and Phase 3 (scraping reliability). Phases 2 and 4 are mostly mechanical.
