-- ============================================================
-- Poirot Fact-Check Engine — Full Production Schema
-- Run against Neon DB (PostgreSQL 15+)
-- ============================================================

-- 1. Enable PGVector for RAG embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Keep existing feedback table (no changes)
-- user_feedback already exists from initial schema

-- 3. Verification log — tracks every fact-check with full audit trail
CREATE TABLE IF NOT EXISTS verification_log (
    id SERIAL PRIMARY KEY,
    claim_type VARCHAR(10) NOT NULL CHECK (claim_type IN ('text', 'image')),
    claim_hash VARCHAR(64) NOT NULL,
    claim_content TEXT NOT NULL,
    language VARCHAR(10) DEFAULT 'en',
    verdict VARCHAR(50),
    confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100),
    trust_score INTEGER CHECK (trust_score >= 0 AND trust_score <= 100),
    explanation TEXT,
    key_findings JSONB DEFAULT '[]',
    sources JSONB DEFAULT '[]',
    reasoning_chain JSONB DEFAULT '[]',
    agents_used JSONB DEFAULT '[]',
    tokens_used INTEGER DEFAULT 0,
    latency_ms INTEGER DEFAULT 0,
    cached BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vlog_hash ON verification_log(claim_hash);
CREATE INDEX IF NOT EXISTS idx_vlog_created ON verification_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vlog_verdict ON verification_log(verdict);

-- 4. Knowledge base — RAG vector store for verified facts
CREATE TABLE IF NOT EXISTS knowledge_base (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    content_type VARCHAR(20) DEFAULT 'fact' CHECK (content_type IN ('fact', 'misinfo_pattern', 'source_profile', 'article')),
    source_url TEXT,
    source_name VARCHAR(255),
    language VARCHAR(10) DEFAULT 'en',
    embedding vector(1024),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kb_embedding ON knowledge_base USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_kb_type ON knowledge_base(content_type);

-- 5. Source profiles — credibility tracking for news sources
CREATE TABLE IF NOT EXISTS source_profiles (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    category VARCHAR(50) DEFAULT 'unknown' CHECK (category IN (
        'mainstream', 'independent', 'state_media', 'tabloid', 
        'satirical', 'social_media', 'fact_checker', 'unknown'
    )),
    country VARCHAR(100),
    bias_label VARCHAR(50) DEFAULT 'unknown' CHECK (bias_label IN (
        'left', 'center-left', 'center', 'center-right', 'right',
        'sensationalist', 'conspiracy', 'unknown'
    )),
    credibility_score INTEGER DEFAULT 50 CHECK (credibility_score >= 0 AND credibility_score <= 100),
    total_claims_checked INTEGER DEFAULT 0,
    true_count INTEGER DEFAULT 0,
    false_count INTEGER DEFAULT 0,
    uncertain_count INTEGER DEFAULT 0,
    last_checked TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sp_domain ON source_profiles(domain);
CREATE INDEX IF NOT EXISTS idx_sp_credibility ON source_profiles(credibility_score DESC);

-- 6. Claim graph — relationships between claims for knowledge graph
CREATE TABLE IF NOT EXISTS claim_graph (
    id SERIAL PRIMARY KEY,
    source_claim_id INTEGER REFERENCES verification_log(id),
    target_claim_id INTEGER REFERENCES verification_log(id),
    relationship VARCHAR(30) NOT NULL CHECK (relationship IN (
        'supports', 'contradicts', 'related', 'same_claim', 'derived_from'
    )),
    confidence FLOAT DEFAULT 0.5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cg_source ON claim_graph(source_claim_id);
CREATE INDEX IF NOT EXISTS idx_cg_target ON claim_graph(target_claim_id);

-- 7. API keys — for enterprise API access
CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    key_hash VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    tier VARCHAR(20) DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
    daily_limit INTEGER DEFAULT 100,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. API usage tracking
CREATE TABLE IF NOT EXISTS api_usage (
    id SERIAL PRIMARY KEY,
    api_key_id INTEGER REFERENCES api_keys(id),
    endpoint VARCHAR(100),
    tokens_used INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_au_key_date ON api_usage(api_key_id, created_at DESC);

-- 9. Trending claims — materialized view refreshed periodically
CREATE MATERIALIZED VIEW IF NOT EXISTS trending_claims AS
SELECT 
    claim_content,
    claim_type,
    verdict,
    COUNT(*) as check_count,
    AVG(confidence) as avg_confidence,
    AVG(trust_score) as avg_trust_score,
    MAX(created_at) as last_checked
FROM verification_log
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY claim_content, claim_type, verdict
ORDER BY check_count DESC
LIMIT 50;

-- 10. Seed some trusted source profiles
INSERT INTO source_profiles (domain, name, category, country, bias_label, credibility_score) VALUES
    ('reuters.com', 'Reuters', 'mainstream', 'Global', 'center', 95),
    ('apnews.com', 'Associated Press', 'mainstream', 'USA', 'center', 95),
    ('bbc.com', 'BBC', 'mainstream', 'UK', 'center', 90),
    ('bdnews24.com', 'bdnews24.com', 'mainstream', 'Bangladesh', 'center', 80),
    ('prothomalo.com', 'Prothom Alo', 'mainstream', 'Bangladesh', 'center', 80),
    ('thedailystar.net', 'The Daily Star', 'mainstream', 'Bangladesh', 'center', 80),
    ('snopes.com', 'Snopes', 'fact_checker', 'USA', 'center', 92),
    ('politifact.com', 'PolitiFact', 'fact_checker', 'USA', 'center', 90),
    ('factcheck.org', 'FactCheck.org', 'fact_checker', 'USA', 'center', 90),
    ('boomlive.in', 'BOOM', 'fact_checker', 'India', 'center', 85),
    ('altnews.in', 'Alt News', 'fact_checker', 'India', 'center', 85),
    ('theonion.com', 'The Onion', 'satirical', 'USA', 'center', 10),
    ('babylonbee.com', 'Babylon Bee', 'satirical', 'USA', 'center-right', 10)
ON CONFLICT (domain) DO NOTHING;

-- 11. GraphRAG Entities
CREATE TABLE IF NOT EXISTS entities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    type VARCHAR(50), 
    description TEXT,
    embedding vector(1024),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_embedding ON entities USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 12. GraphRAG Entity Relationships
CREATE TABLE IF NOT EXISTS entity_relationships (
    id SERIAL PRIMARY KEY,
    source_entity_id INTEGER REFERENCES entities(id),
    target_entity_id INTEGER REFERENCES entities(id),
    relationship_type VARCHAR(100),
    evidence_text TEXT,
    source_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_entity_id, target_entity_id, relationship_type)
);
CREATE INDEX IF NOT EXISTS idx_er_source ON entity_relationships(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_er_target ON entity_relationships(target_entity_id);
