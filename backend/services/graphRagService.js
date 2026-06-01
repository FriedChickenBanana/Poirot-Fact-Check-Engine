// ══════════════════════════════════════════════════════════════════════════
// GRAPH RAG SERVICE — PostgreSQL-Native Knowledge Graph
//
// AutoLlama-inspired Contextual Graph Retrieval:
// 1. Extracts entities (PERSON, ORG, LOCATION, EVENT) and relationships
// 2. Stores them in PostgreSQL relational tables (entities, entity_relationships)
// 3. Retrieves semantic subgraphs for grounded reasoning, reducing LLM hallucinations
// ══════════════════════════════════════════════════════════════════════════

const { Pool } = require('pg');
const { Anthropic } = require('@anthropic-ai/sdk');
const { textToSimpleVector } = require('./ragService');
const { extractJson } = require('../utils/helpers');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── 1. Extract Entities and Relationships using LLM ────────────────────────
async function extractEntities(text) {
  const systemPrompt = `You are an AI specialized in building Knowledge Graphs for Fact-Checking.
Extract key entities (PERSON, ORG, LOCATION, EVENT) and relationships from the text.
Return ONLY JSON in this exact format:
{
  "entities": [
    {"name": "Entity Name", "type": "PERSON|ORG|LOCATION|EVENT", "description": "Short bio/desc"}
  ],
  "relationships": [
    {"source": "Entity Name", "target": "Entity Name", "relationship": "met_with|founded|said|occurred_in", "evidence": "text snippet"}
  ]
}
Be concise. Only extract verifiable facts.`;

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: text.substring(0, 2000) }],
    });

    const raw = res.content.find(b => b.type === 'text')?.text || '';
    return extractJson(raw);
  } catch (err) {
    console.warn('[GraphRAG] Extraction failed:', err.message);
    return { entities: [], relationships: [] };
  }
}

// ── 2. Save Knowledge Graph to PostgreSQL ──────────────────────────────────
async function saveToGraph(text, sourceUrl = '') {
  const { entities, relationships } = await extractEntities(text);
  if (!entities || entities.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Insert/Upsert Entities
    const entityIdMap = {};
    for (const ent of entities) {
      if (!ent.name) continue;
      const embedding = await textToSimpleVector(ent.description || ent.name);
      const vectorStr = `[${embedding.join(',')}]`;
      
      const res = await client.query(
        `INSERT INTO entities (name, type, description, embedding)
         VALUES ($1, $2, $3, $4::vector)
         ON CONFLICT (name) DO UPDATE SET 
            description = EXCLUDED.description 
         RETURNING id`,
        [ent.name, ent.type, ent.description, vectorStr]
      );
      entityIdMap[ent.name] = res.rows[0].id;
    }

    // 2. Insert Relationships
    if (relationships && relationships.length > 0) {
      for (const rel of relationships) {
        const sourceId = entityIdMap[rel.source];
        const targetId = entityIdMap[rel.target];
        
        if (sourceId && targetId && sourceId !== targetId) {
          await client.query(
            `INSERT INTO entity_relationships (source_entity_id, target_entity_id, relationship_type, evidence_text, source_url)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (source_entity_id, target_entity_id, relationship_type) DO NOTHING`,
            [sourceId, targetId, rel.relationship, rel.evidence || '', sourceUrl]
          );
        }
      }
    }

    await client.query('COMMIT');
    console.log(`[GraphRAG] Saved ${entities.length} entities and ${relationships?.length || 0} relationships.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.warn('[GraphRAG] Transaction failed:', err.message);
  } finally {
    client.release();
  }
}

// ── 3. Retrieve Graph Context (AutoLlama Contextual Retrieval) ─────────────
async function retrieveGraphContext(query, topK = 3) {
  try {
    const queryVector = await textToSimpleVector(query);
    const vectorStr = `[${queryVector.join(',')}]`;

    // Step 1: Find most relevant entities via vector similarity
    const entityRes = await pool.query(
      `SELECT id, name, type, description, 1 - (embedding <=> $1::vector) as similarity
       FROM entities
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [vectorStr, topK]
    );

    if (entityRes.rows.length === 0) return '';

    const entityIds = entityRes.rows.map(r => r.id);
    const placeholders = entityIds.map((_, i) => `$${i + 1}`).join(',');

    // Step 2: Retrieve 1-hop relationships for these entities
    const relRes = await pool.query(
      `SELECT 
          e1.name as source_name, 
          er.relationship_type, 
          e2.name as target_name, 
          er.evidence_text
       FROM entity_relationships er
       JOIN entities e1 ON er.source_entity_id = e1.id
       JOIN entities e2 ON er.target_entity_id = e2.id
       WHERE er.source_entity_id IN (${placeholders}) 
          OR er.target_entity_id IN (${placeholders})
       LIMIT 10`,
      entityIds
    );

    // Step 3: Format the context
    let context = '== GRAPH RAG ENTITIES ==\n';
    entityRes.rows.forEach(e => {
      context += `- ${e.name} (${e.type}): ${e.description}\n`;
    });

    if (relRes.rows.length > 0) {
      context += '\n== KNOWN RELATIONSHIPS ==\n';
      relRes.rows.forEach(r => {
        context += `- ${r.source_name} [${r.relationship_type}] ${r.target_name}. (Evidence: "${r.evidence_text}")\n`;
      });
    }

    return context;
  } catch (err) {
    console.warn('[GraphRAG] Search failed:', err.message);
    return '';
  }
}

module.exports = {
  extractEntities,
  saveToGraph,
  retrieveGraphContext
};
