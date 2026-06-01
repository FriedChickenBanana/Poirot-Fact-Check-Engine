require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const { Pool } = require('pg');

const verifyRoutes = require('./routes/verifyRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const apiRoutes = require('./routes/apiRoutes');
const { scrapeAllFeeds } = require('./services/scraperService');

const app = express();

// ── Security & Performance ──────────────────────────────────────────────
app.use(compression());
app.use(cors({
  origin: (origin, cb) => {
    // Allow: Chrome extension, localhost dev, ngrok tunnels, Render deployments
    if (!origin ||
        origin.startsWith('chrome-extension://') ||
        origin.includes('localhost') ||
        origin.includes('ngrok') ||
        origin.includes('onrender.com')) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));
app.use(express.json({ limit: '50mb' }));

// ── In-memory IP rate limiter for the internal /verify route ─────────────
// Prevents Chrome extension abuse — 20 req/min per IP
const ipWindows = new Map();
function internalRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const hits = (ipWindows.get(ip) || []).filter(t => now - t < 60000);
  hits.push(now);
  ipWindows.set(ip, hits);
  if (hits.length > 20) {
    return res.status(429).json({ verdict: 'Error', explanation: 'Too many requests. Please wait a moment.' });
  }
  next();
}

// ── Serve the public dashboard as static files ──────────────────────────
app.use(express.static(path.join(__dirname, '..', 'dashboard')));

// ── Health Check ────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  engine: 'Poirot Fact-Check Engine',
  version: '2.0.0',
  uptime: process.uptime(),
}));

// ── Internal Routes (Chrome Extension) ──────────────────────────────────
app.use('/verify', internalRateLimit, verifyRoutes);
app.use('/feedback', feedbackRoutes);

// ── Dashboard API Routes ────────────────────────────────────────────────
app.use('/api/dashboard', dashboardRoutes);

// ── Enterprise API v1 ───────────────────────────────────────────────────
app.use('/api/v1', apiRoutes);

// ── Dashboard fallback — serve index.html for SPA routes ────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dashboard', 'index.html'));
});

// ── Global Error Handler ────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.message);
  res.status(500).json({
    verdict: 'Error',
    explanation: err.message || 'An unexpected error occurred.',
    confidence: 0,
    key_findings: [],
    sources: [],
  });
});

// ── Start ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🔍 Poirot Fact-Check Engine v2.0`);
  console.log(`   Backend  → http://localhost:${PORT}`);
  console.log(`   Dashboard → http://localhost:${PORT}/`);
  console.log(`   API Docs  → http://localhost:${PORT}/api-docs.html`);
  console.log(`   Health    → http://localhost:${PORT}/health\n`);
});

// ── Keep trending_claims materialized view fresh (every hour) ────────────
const mvPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
setInterval(async () => {
  try {
    await mvPool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY trending_claims');
    console.log('[MV] trending_claims refreshed');
  } catch (e) {
    console.warn('[MV] Refresh skipped:', e.message);
  }
}, 3600000);

// ── Seed knowledge base with real news on startup, then every 6 hours ─────
setTimeout(() => scrapeAllFeeds().catch(e => console.warn('[Scraper]', e.message)), 5000);
setInterval(() => scrapeAllFeeds().catch(e => console.warn('[Scraper]', e.message)), 6 * 3600000);
