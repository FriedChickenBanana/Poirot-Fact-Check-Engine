// ══════════════════════════════════════════════════════════════════════════
// RAG SERVICE — Retrieval Augmented Generation with PGVector
//
// Embedding strategy (in priority order):
//   1. Voyage AI (voyage-3, 1024-dim) — set VOYAGE_API_KEY for real semantics
//      Free tier: 50M tokens. Cost: ~$0.06/1M tokens after that.
//   2. Hash-based bigram fallback — zero cost, decent for keyword overlap
// ══════════════════════════════════════════════════════════════════════════

const { Pool } = require('pg');
const crypto = require('crypto');
const https = require('https');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Voyage AI embedding call (returns null on any failure) ────────────────
async function getVoyageEmbedding(text) {
  const body = JSON.stringify({
    input: [text.substring(0, 4096)],
    model: 'voyage-3', // 1024 dimensions — matches schema exactly
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.voyageai.com',
      path: '/v1/embeddings',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const embedding = parsed.data?.[0]?.embedding;
          resolve(Array.isArray(embedding) && embedding.length === 1024 ? embedding : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ── Hash-based bigram fallback (zero cost) ────────────────────────────────
function hashVector(text, dimensions = 1024) {
  const normalized = text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = normalized.split(' ').filter(Boolean);
  const vector = new Array(dimensions).fill(0);

  for (const word of words) {
    const hash = crypto.createHash('md5').update(word).digest();
    for (let i = 0; i < 4; i++) {
      const idx = (hash[i] + hash[(i + 1) % hash.length] * 256) % dimensions;
      vector[idx] += 1;
    }
  }

  // Add bigrams for phrase-level semantics
  for (let i = 0; i < words.length - 1; i++) {
    const hash = crypto.createHash('md5').update(`${words[i]}_${words[i + 1]}`).digest();
    const idx = (hash[0] + hash[1] * 256) % dimensions;
    vector[idx] += 1.5;
  }

  const magnitude = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
  return vector.map(v => v / magnitude);
}

// ── Primary embedding function — Voyage AI with hash fallback ────────────
async function textToSimpleVector(text, dimensions = 1024) {
  if (process.env.VOYAGE_API_KEY) {
    const embedding = await getVoyageEmbedding(text);
    if (embedding) return embedding;
  }
  return hashVector(text, dimensions);
}

// ── Add content to knowledge base ────────────────────────────────────────
// Pass `quiet: true` for bulk inserts (e.g. the RSS scraper) which log their
// own aggregate; the per-row log is only useful for one-off verify-time saves.
async function addToKnowledgeBase({ content, contentType, sourceUrl, sourceName, language, metadata, quiet }) {
  const embedding = await textToSimpleVector(content);
  const vectorStr = `[${embedding.join(',')}]`;

  try {
    const res = await pool.query(
      `INSERT INTO knowledge_base (content, content_type, source_url, source_name, language, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
       ON CONFLICT DO NOTHING`,
      [content, contentType || 'fact', sourceUrl, sourceName, language || 'en', vectorStr, JSON.stringify(metadata || {})]
    );
    if (!quiet && res.rowCount > 0) {
      console.log(`[RAG] Saved 1 ${contentType || 'fact'} to knowledge base`);
    }
  } catch (err) {
    console.warn('[RAG] Insert failed:', err.message);
  }
}

// ── Search knowledge base for relevant context ───────────────────────────
// Uses both vector similarity AND full-text search for best results.
const MIN_VECTOR_SIM = 0.5; // cosine-similarity floor — drop loosely-related matches

async function searchRelevantContext(query, topK = 3) {
  try {
    // Method 1 (full-text) needs no embedding, so run it in parallel with the
    // embedding generation rather than waiting for one before the other.
    // 'simple' config works for both English and Bangla ('english' only handles
    // ASCII; 'simple' tokenizes any Unicode including বাংলা).
    const [textResults, queryVector] = await Promise.all([
      pool.query(
        `SELECT content, content_type, source_name, source_url,
                ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', $1)) as rank
         FROM knowledge_base
         WHERE to_tsvector('simple', content) @@ plainto_tsquery('simple', $1)
         ORDER BY rank DESC
         LIMIT $2`,
        [query.substring(0, 500), topK]
      ),
      textToSimpleVector(query),
    ]);

    // Method 2: Vector similarity, keeping only matches above the relevance floor.
    let vectorResults = { rows: [] };
    if (Array.isArray(queryVector)) {
      const vectorStr = `[${queryVector.join(',')}]`;
      try {
        // Fetch the nearest rows unfiltered so we can log the actual best
        // similarity; the relevance floor is applied in JS below.
        vectorResults = await pool.query(
          `SELECT content, content_type, source_name, source_url,
                  1 - (embedding <=> $1::vector) as similarity
           FROM knowledge_base
           WHERE embedding IS NOT NULL
           ORDER BY embedding <=> $1::vector
           LIMIT $2`,
          [vectorStr, topK]
        );
      } catch {
        // Vector extension might not be available yet
      }
    }

    // Best raw scores found (even below the floor) — shows how close the nearest
    // stored fact was, so the terminal always reports a real RAG score.
    const topSim = Math.max(0, ...vectorResults.rows.map(r => Number(r.similarity) || 0));
    const topRank = Math.max(0, ...textResults.rows.map(r => Number(r.rank) || 0));

    // Keep only vector hits at/above the relevance floor; full-text hits already
    // required real lexical overlap, so they stay as-is.
    const relevantVector = vectorResults.rows.filter(r => (Number(r.similarity) || 0) >= MIN_VECTOR_SIM);

    const seen = new Set();
    const merged = [];
    for (const row of [...textResults.rows, ...relevantVector]) {
      const key = row.content.substring(0, 100);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(row);
      }
    }

    if (merged.length === 0) {
      console.log(`[RAG] No relevant context | best vector sim: ${topSim.toFixed(3)} (floor ${MIN_VECTOR_SIM}) | best text rank: ${topRank.toFixed(3)}`);
      return '';
    }

    console.log(`[RAG] Used ${merged.length} passage(s) | top vector sim: ${topSim.toFixed(3)} | top text rank: ${topRank.toFixed(3)}`);

    // Format as context string for injection into prompt
    return merged
      .slice(0, topK)
      .map((r, i) => `[${i + 1}] ${r.content_type}: ${r.content.substring(0, 300)}${r.source_name ? ` (Source: ${r.source_name})` : ''}`)
      .join('\n');

  } catch (err) {
    console.warn('[RAG] Search failed:', err.message);
    return '';
  }
}

// ── Store verification result as knowledge ──────────────────────────────
async function learnFromVerification(claim, verdict, sources) {
  const contentType = verdict === 'Likely True' ? 'fact'
    : verdict === 'Likely False' ? 'misinfo_pattern'
      : 'fact';

  await addToKnowledgeBase({
    content: `Claim: "${claim}" — Verdict: ${verdict}`,
    contentType,
    sourceUrl: sources?.[0],
    sourceName: 'Poirot Self-Verified',
    metadata: { verdict, auto_learned: true },
  });
}

// ── Find similar past claims (semantic deduplication) ────────────────────
async function findSimilarClaims(claimText, threshold = 0.8) {
  try {
    const queryVector = await textToSimpleVector(claimText);
    const vectorStr = `[${queryVector.join(',')}]`;

    const result = await pool.query(
      `SELECT content, content_type, source_name,
              1 - (embedding <=> $1::vector) as similarity
       FROM knowledge_base
       WHERE 1 - (embedding <=> $1::vector) > $2
       ORDER BY similarity DESC
       LIMIT 3`,
      [vectorStr, threshold]
    );

    return result.rows;
  } catch {
    return [];
  }
}

module.exports = {
  addToKnowledgeBase,
  searchRelevantContext,
  learnFromVerification,
  findSimilarClaims,
  textToSimpleVector,
};
