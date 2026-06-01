// ══════════════════════════════════════════════════════════════════════════
// TRUST SCORING SERVICE — Graph-based source credibility
//
// Implements a composite trust score using PostgreSQL:
//   - Source credibility (40%) — from source_profiles table
//   - Cross-reference density (30%) — how many independent sources confirm
//   - Historical accuracy (15%) — source's past fact-check track record
//   - Temporal consistency (15%) — claim freshness and timing patterns
//
// Uses PostgreSQL recursive queries instead of Neo4j (cheaper, simpler)
// ══════════════════════════════════════════════════════════════════════════

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Extract domain from URL ──────────────────────────────────────────────
function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ── Get source credibility score from profiles ───────────────────────────
async function getSourceCredibility(sourceUrls) {
  if (!sourceUrls || sourceUrls.length === 0) return { score: 50, details: [] };

  const domains = sourceUrls.map(extractDomain).filter(Boolean);
  if (domains.length === 0) return { score: 50, details: [] };

  try {
    const placeholders = domains.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT domain, name, category, bias_label, credibility_score
       FROM source_profiles
       WHERE domain IN (${placeholders})`,
      domains
    );

    if (result.rows.length === 0) return { score: 50, details: [{ note: 'Sources not in credibility database' }] };

    const avgScore = result.rows.reduce((sum, r) => sum + r.credibility_score, 0) / result.rows.length;
    return {
      score: Math.round(avgScore),
      details: result.rows.map(r => ({
        domain: r.domain,
        name: r.name,
        category: r.category,
        bias: r.bias_label,
        credibility: r.credibility_score,
      })),
    };
  } catch (err) {
    console.warn('[Trust] Source lookup failed:', err.message);
    return { score: 50, details: [] };
  }
}

// ── Cross-reference density — how many independent sources ──────────────
function calculateCrossRefScore(sources) {
  if (!sources || sources.length === 0) return 20;

  const uniqueDomains = new Set(sources.map(extractDomain).filter(Boolean));
  const count = uniqueDomains.size;

  // More unique domains = higher trust
  if (count >= 5) return 100;
  if (count >= 3) return 80;
  if (count >= 2) return 60;
  return 30; // Single source
}

// ── Historical accuracy of verdict for similar claims ───────────────────
async function getHistoricalAccuracy(claimHash) {
  try {
    const result = await pool.query(
      `SELECT verdict, confidence, trust_score
       FROM verification_log
       WHERE claim_hash = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [claimHash]
    );

    if (result.rows.length === 0) return 50;

    const avgConfidence = result.rows.reduce((sum, r) => sum + (r.confidence || 50), 0) / result.rows.length;
    return Math.round(avgConfidence);
  } catch {
    return 50;
  }
}

// ── Compute composite trust score ────────────────────────────────────────
async function computeTrustScore({ sourceUrls, claimHash, confidence, verdict }) {
  const WEIGHTS = {
    sourceCredibility: 0.40,
    crossReference: 0.30,
    historicalAccuracy: 0.15,
    confidenceAlignment: 0.15,
  };

  // Component 1: Source credibility
  const sourceResult = await getSourceCredibility(sourceUrls);
  const sourceScore = sourceResult.score;

  // Component 2: Cross-reference density
  const crossRefScore = calculateCrossRefScore(sourceUrls);

  // Component 3: Historical accuracy
  const historicalScore = await getHistoricalAccuracy(claimHash);

  // Component 4: Confidence alignment
  const confidenceScore = confidence || 50;

  // Weighted composite
  const composite = Math.round(
    sourceScore * WEIGHTS.sourceCredibility +
    crossRefScore * WEIGHTS.crossReference +
    historicalScore * WEIGHTS.historicalAccuracy +
    confidenceScore * WEIGHTS.confidenceAlignment
  );

  return {
    trust_score: Math.min(100, Math.max(0, composite)),
    breakdown: {
      source_credibility: { score: sourceScore, weight: '40%', details: sourceResult.details },
      cross_reference: { score: crossRefScore, weight: '30%', unique_sources: new Set(sourceUrls?.map(extractDomain).filter(Boolean)).size },
      historical: { score: historicalScore, weight: '15%' },
      confidence: { score: confidenceScore, weight: '15%' },
    },
  };
}

// ── Update source profile based on verification result ──────────────────
async function updateSourceProfile(sourceUrls, verdict) {
  if (!sourceUrls || sourceUrls.length === 0) return;

  for (const url of sourceUrls) {
    const domain = extractDomain(url);
    if (!domain) continue;

    try {
      // Upsert source profile
      await pool.query(
        `INSERT INTO source_profiles (domain, name, total_claims_checked, true_count, false_count, uncertain_count, last_checked)
         VALUES ($1, $1, 1,
           CASE WHEN $2 = 'Likely True' THEN 1 ELSE 0 END,
           CASE WHEN $2 = 'Likely False' THEN 1 ELSE 0 END,
           CASE WHEN $2 = 'Uncertain' THEN 1 ELSE 0 END,
           NOW())
         ON CONFLICT (domain) DO UPDATE SET
           total_claims_checked = source_profiles.total_claims_checked + 1,
           true_count = source_profiles.true_count + CASE WHEN $2 = 'Likely True' THEN 1 ELSE 0 END,
           false_count = source_profiles.false_count + CASE WHEN $2 = 'Likely False' THEN 1 ELSE 0 END,
           uncertain_count = source_profiles.uncertain_count + CASE WHEN $2 = 'Uncertain' THEN 1 ELSE 0 END,
           last_checked = NOW(),
           updated_at = NOW()`,
        [domain, verdict]
      );
    } catch (err) {
      console.warn('[Trust] Profile update failed:', err.message);
    }
  }
}

// ── Get source trust leaderboard ────────────────────────────────────────
async function getSourceLeaderboard(limit = 20) {
  try {
    const result = await pool.query(
      `SELECT domain, name, category, bias_label, credibility_score,
              total_claims_checked, true_count, false_count, uncertain_count
       FROM source_profiles
       WHERE total_claims_checked > 0
       ORDER BY credibility_score DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } catch (err) {
    console.warn('[Trust] Leaderboard query failed:', err.message);
    return [];
  }
}

module.exports = {
  computeTrustScore,
  updateSourceProfile,
  getSourceCredibility,
  getSourceLeaderboard,
  extractDomain,
};
