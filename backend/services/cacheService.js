const Redis = require('ioredis');
const crypto = require('crypto');

let redis = null;

function getRedis() {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL);
    redis.on('error', (err) => console.error('[Redis]', err.message));
  }
  return redis;
}

function cacheKey(type, content, options = {}) {
  const language = options.language || 'en';
  const lowBandwidth = options.lowBandwidth ? '1' : '0';
  const hash = crypto
    .createHash('sha256')
    .update(`${type}:${content.trim()}:${language}:${lowBandwidth}`)
    .digest('hex');
  return `verify:${hash}`;
}

const TTL_SECONDS = 86400; // 24 hours

async function getCached(type, content, options = {}) {
  try {
    const val = await getRedis().get(cacheKey(type, content, options));
    return val ? JSON.parse(val) : null;
  } catch (err) {
    console.warn('[Redis] GET failed:', err.message);
    return null;
  }
}

async function setCached(type, content, result, options = {}) {
  try {
    await getRedis().set(cacheKey(type, content, options), JSON.stringify(result), 'EX', TTL_SECONDS);
  } catch (err) {
    console.warn('[Redis] SET failed:', err.message);
  }
}

module.exports = { getCached, setCached };
