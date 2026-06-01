// ══════════════════════════════════════════════════════════════════════════
// API KEY AUTHENTICATION MIDDLEWARE
// ══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required. Pass via x-api-key header.' });
  }

  try {
    const keyHash = hashKey(apiKey);
    const result = await pool.query(
      'SELECT id, name, tier, daily_limit, is_active FROM api_keys WHERE key_hash = $1',
      [keyHash]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(403).json({ error: 'Invalid or deactivated API key.' });
    }

    // Check daily usage
    const usage = await pool.query(
      `SELECT COUNT(*)::int as today_count FROM api_usage 
       WHERE api_key_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
      [result.rows[0].id]
    );

    if (usage.rows[0].today_count >= result.rows[0].daily_limit) {
      return res.status(429).json({ 
        error: 'Daily API limit exceeded.',
        limit: result.rows[0].daily_limit,
        tier: result.rows[0].tier,
      });
    }

    req.apiKey = result.rows[0];
    next();
  } catch (err) {
    console.error('[API Auth]', err.message);
    return res.status(500).json({ error: 'Authentication service error.' });
  }
}

async function trackUsage(req, res, next) {
  if (req.apiKey) {
    try {
      await pool.query(
        'INSERT INTO api_usage (api_key_id, endpoint) VALUES ($1, $2)',
        [req.apiKey.id, req.path]
      );
    } catch (err) {
      console.warn('[API Usage] Track failed:', err.message);
    }
  }
  next();
}

module.exports = { apiKeyAuth, trackUsage, hashKey };
