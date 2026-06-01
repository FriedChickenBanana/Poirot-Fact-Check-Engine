const express = require('express');
const router = express.Router();
const { getStats, getRecentVerifications, getTrends, getVerdictDistribution, getTopMisinformation } = require('../services/analyticsService');
const { getSourceLeaderboard } = require('../services/trustScoringService');

// GET /api/dashboard/stats
router.get('/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/recent
router.get('/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const recent = await getRecentVerifications(limit);
    res.json(recent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/trends
router.get('/trends', async (req, res) => {
  try {
    const trends = await getTrends();
    res.json(trends);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/verdicts
router.get('/verdicts', async (req, res) => {
  try {
    const distribution = await getVerdictDistribution();
    res.json(distribution);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/sources
router.get('/sources', async (req, res) => {
  try {
    const sources = await getSourceLeaderboard(parseInt(req.query.limit) || 20);
    res.json(sources);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/misinformation
router.get('/misinformation', async (req, res) => {
  try {
    const misinfo = await getTopMisinformation(parseInt(req.query.limit) || 10);
    res.json(misinfo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
