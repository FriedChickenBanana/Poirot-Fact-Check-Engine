// ══════════════════════════════════════════════════════════════════════════
// RATE LIMITER — Redis-backed sliding window
// ══════════════════════════════════════════════════════════════════════════

const Redis = require('ioredis');

let redis = null;
function getRedis() {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL);
    redis.on('error', (err) => console.error('[RateLimit Redis]', err.message));
  }
  return redis;
}

async function apiRateLimiter(req, res, next) {
  const identifier = req.apiKey?.id || req.ip;
  const key = `ratelimit:${identifier}:${Math.floor(Date.now() / 60000)}`; // per-minute window

  try {
    const count = await getRedis().incr(key);
    if (count === 1) await getRedis().expire(key, 60);

    const limit = req.apiKey?.tier === 'enterprise' ? 60 : req.apiKey?.tier === 'pro' ? 30 : 10;

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - count));

    if (count > limit) {
      return res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });
    }
  } catch (err) {
    console.warn('[RateLimit] Redis error, allowing request:', err.message);
  }

  next();
}

module.exports = { apiRateLimiter };
