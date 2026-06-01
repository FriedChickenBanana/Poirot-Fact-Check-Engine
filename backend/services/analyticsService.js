// ══════════════════════════════════════════════════════════════════════════
// ANALYTICS SERVICE — Tracks verifications for dashboard + insights
// ══════════════════════════════════════════════════════════════════════════

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function logVerification(data) {
  try {
    await pool.query(
      `INSERT INTO verification_log 
        (claim_type, claim_hash, claim_content, language, verdict, confidence, trust_score,
         explanation, key_findings, sources, reasoning_chain, agents_used, tokens_used, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        data.claimType, data.claimHash, data.claimContent, data.language || 'en',
        data.verdict, data.confidence, data.trustScore,
        data.explanation, JSON.stringify(data.keyFindings || []),
        JSON.stringify(data.sources || []), JSON.stringify(data.reasoningChain || []),
        JSON.stringify(data.agentsUsed || []), data.tokensUsed || 0, data.latencyMs || 0,
      ]
    );
  } catch (err) {
    console.warn('[Analytics] Log failed:', err.message);
  }
}

async function getStats() {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*)::int as total_checks,
        COUNT(CASE WHEN verdict = 'Likely True' THEN 1 END)::int as true_count,
        COUNT(CASE WHEN verdict = 'Likely False' THEN 1 END)::int as false_count,
        COUNT(CASE WHEN verdict = 'Uncertain' THEN 1 END)::int as uncertain_count,
        COUNT(CASE WHEN verdict = 'Satirical' THEN 1 END)::int as satirical_count,
        ROUND(AVG(confidence))::int as avg_confidence,
        ROUND(AVG(trust_score))::int as avg_trust_score,
        ROUND(AVG(latency_ms))::int as avg_latency_ms,
        SUM(tokens_used)::int as total_tokens,
        COUNT(CASE WHEN claim_type = 'image' THEN 1 END)::int as image_checks,
        COUNT(CASE WHEN claim_type = 'text' THEN 1 END)::int as text_checks,
        COUNT(CASE WHEN language = 'bn' THEN 1 END)::int as bangla_checks,
        COUNT(CASE WHEN cached = true THEN 1 END)::int as cache_hits
      FROM verification_log
    `);
    return result.rows[0] || {};
  } catch (err) {
    console.warn('[Analytics] Stats query failed:', err.message);
    return {};
  }
}

async function getRecentVerifications(limit = 20) {
  try {
    const result = await pool.query(
      `SELECT id, claim_type, claim_content, language, verdict, confidence, trust_score,
              explanation, key_findings, sources, agents_used, tokens_used, latency_ms, created_at
       FROM verification_log
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } catch (err) {
    console.warn('[Analytics] Recent query failed:', err.message);
    return [];
  }
}

async function getTrends() {
  try {
    const result = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*)::int as checks,
        COUNT(CASE WHEN verdict = 'Likely False' THEN 1 END)::int as false_claims,
        ROUND(AVG(confidence))::int as avg_confidence
      FROM verification_log
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `);
    return result.rows;
  } catch (err) {
    console.warn('[Analytics] Trends query failed:', err.message);
    return [];
  }
}

async function getVerdictDistribution() {
  try {
    const result = await pool.query(`
      SELECT verdict, COUNT(*)::int as count
      FROM verification_log
      GROUP BY verdict
      ORDER BY count DESC
    `);
    return result.rows;
  } catch (err) {
    return [];
  }
}

async function getTopMisinformation(limit = 10) {
  try {
    const result = await pool.query(
      `SELECT claim_content, verdict, confidence, trust_score, sources, created_at
       FROM verification_log
       WHERE verdict = 'Likely False'
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } catch (err) {
    return [];
  }
}

module.exports = {
  logVerification,
  getStats,
  getRecentVerifications,
  getTrends,
  getVerdictDistribution,
  getTopMisinformation,
};
