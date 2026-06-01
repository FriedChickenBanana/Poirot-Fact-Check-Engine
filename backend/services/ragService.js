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
async function addToKnowledgeBase({ content, contentType, sourceUrl, sourceName, language, metadata }) {
  const embedding = await textToSimpleVector(content);
  const vectorStr = `[${embedding.join(',')}]`;
  
  try {
    await pool.query(
      `INSERT INTO knowledge_base (content, content_type, source_url, source_name, language, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
       ON CONFLICT DO NOTHING`,
      [content, contentType || 'fact', sourceUrl, sourceName, language || 'en', vectorStr, JSON.stringify(metadata || {})]
    );
  } catch (err) {
    console.warn('[RAG] Insert failed:', err.message);
  }
}

// ── Search knowledge base for relevant context ───────────────────────────
// Uses both vector similarity AND full-text search for best results
async function searchRelevantContext(query, topK = 3) {
  try {
    // Method 1: Full-text search using 'simple' config — works for both English and Bangla
    // ('english' config only handles ASCII; 'simple' tokenizes any Unicode including বাংলা)
    const textResults = await pool.query(
      `SELECT content, content_type, source_name, source_url,
              ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', $1)) as rank
       FROM knowledge_base
       WHERE to_tsvector('simple', content) @@ plainto_tsquery('simple', $1)
       ORDER BY rank DESC
       LIMIT $2`,
      [query.substring(0, 500), topK]
    );

    // Method 2: Vector similarity (if we have embeddings)
    const queryVector = await textToSimpleVector(query);
    const vectorStr = `[${queryVector.join(',')}]`;
    
    let vectorResults = { rows: [] };
    try {
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

    // Merge and deduplicate results
    const seen = new Set();
    const merged = [];
    
    for (const row of [...textResults.rows, ...vectorResults.rows]) {
      const key = row.content.substring(0, 100);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(row);
      }
    }

    if (merged.length === 0) return '';

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
