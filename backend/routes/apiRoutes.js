const express = require('express');
const router = express.Router();
const { verifyFactCheck } = require('../controllers/verifyController');
const { apiKeyAuth, trackUsage } = require('../middleware/apiAuth');
const { apiRateLimiter } = require('../middleware/rateLimiter');

// ── Public API v1 Routes (requires API key) ─────────────────────────────

// POST /api/v1/verify — Single claim verification
router.post('/verify', apiKeyAuth, apiRateLimiter, trackUsage, verifyFactCheck);

// POST /api/v1/verify/batch — Batch verification (up to 10 claims)
router.post('/verify/batch', apiKeyAuth, apiRateLimiter, trackUsage, async (req, res) => {
  try {
    const { claims } = req.body;
    if (!claims || !Array.isArray(claims) || claims.length === 0) {
      return res.status(400).json({ error: 'Provide an array of claims' });
    }
    if (claims.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 claims per batch' });
    }

    // Process in parallel chunks of 3 — 3x faster than sequential, safe for API limits
    const verifyOne = (claim) => new Promise((resolve) => {
      const mockReq = { body: { type: 'text', content: claim } };
      const mockRes = {
        json: (data) => resolve({ claim, ...data }),
        status: () => ({ json: (data) => resolve({ claim, ...data }) }),
      };
      verifyFactCheck(mockReq, mockRes, (err) => resolve({ claim, verdict: 'Error', explanation: err?.message || 'Verification failed' }));
    });

    const results = [];
    for (let i = 0; i < claims.length; i += 3) {
      const chunk = await Promise.all(claims.slice(i, i + 3).map(verifyOne));
      results.push(...chunk);
    }

    res.json({ results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/health — API health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    engine: 'Poirot Fact-Check Engine',
    capabilities: ['text_verification', 'image_verification', 'trust_scoring', 'batch_verification'],
  });
});

module.exports = router;
