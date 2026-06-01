const crypto = require('crypto');
const { buildImageBlock, extractJson } = require('../utils/helpers');
const { orchestrate } = require('../services/agentOrchestrator');
const { getCached, setCached } = require('../services/cacheService');
const { learnFromVerification } = require('../services/ragService');
const { saveToGraph } = require('../services/graphRagService');
const { computeTrustScore, updateSourceProfile } = require('../services/trustScoringService');
const { logVerification } = require('../services/analyticsService');

async function verifyFactCheck(req, res, next) {
  const t0 = Date.now();
  try {
    const { type, content, persona = 'General Public', base64 } = req.body;
    if (!content && !base64) {
      return res.status(400).json({ verdict: 'Error', explanation: 'No content provided.' });
    }
    // Image-only requests carry no text `content`. Use a safe string everywhere
    // downstream so .substring()/.trim() never throw on undefined.
    const safeContent = content || '';

    // ── Step 0: Cache check (Token Optimization) ────────────────────────
    let cacheKey = safeContent;
    if (type === 'image' && base64) {
      // Hash the base64 to ensure we don't re-process the same image pixels
      cacheKey = crypto.createHash('sha256').update(base64).digest('hex');
    }
    
    const cached = await getCached(type, cacheKey);
    if (cached) {
      console.log(`[Cache HIT] ${Date.now() - t0}ms`);
      return res.json({ ...cached, cached: true });
    }

    // ── Step 1: Build image block if needed ──────────────────────────────
    const imageBlock = type === 'image' && base64 ? buildImageBlock(base64) : null;
    const queryContent = content || 'image claim';

    // ── Step 2: Multi-agent orchestration ──────────────────────────────
    // The orchestrator now owns context retrieval (RAG + Google Fact Check +
    // GraphRAG): it runs those lookups against the *extracted* claim after the
    // vision/classify step, not the raw image URL, and skips them entirely on a
    // satire short-circuit. See agentOrchestrator.orchestrate().
    const result = await orchestrate({
      type,
      content: queryContent,
      base64,
      imageBlock,
      persona,
    });

    // ── Step 6: Compute trust score ────────────────────────────────────
    const claimHash = crypto.createHash('sha256').update(`${type}:${cacheKey.trim()}`).digest('hex');
    const trustResult = await computeTrustScore({
      sourceUrls: result.sources,
      claimHash,
      confidence: result.confidence,
      verdict: result.verdict,
    });
    result.trust_score = trustResult.trust_score;
    result.trust_breakdown = trustResult.breakdown;

    // ── Step 7: Respond to the client NOW ──────────────────────────────
    // Everything below (profile updates, self-learning, graph building,
    // analytics logging, caching) is bookkeeping the caller does not wait on.
    // Sending the response first cuts perceived latency by several DB writes.
    const latencyMs = Date.now() - t0;
    console.log(`[Done] ${latencyMs}ms | Tokens: ${result.tokens_used} | Agents: ${result.agents_used.join(',')}`);
    res.json(result);

    // ── Step 8: Background persistence (fire-and-forget, never blocks) ──
    Promise.allSettled([
      updateSourceProfile(result.sources, result.verdict),
      learnFromVerification(safeContent.substring(0, 500), result.verdict, result.sources),
      setCached(type, cacheKey, result),
      (result.verdict === 'Likely True' || result.verdict === 'Likely False')
        ? saveToGraph(safeContent.substring(0, 1000), result.sources?.[0])
        : Promise.resolve(),
      logVerification({
        claimType: type,
        claimHash,
        claimContent: safeContent.substring(0, 2000),
        language: result.language,
        verdict: result.verdict,
        confidence: result.confidence,
        trustScore: result.trust_score,
        explanation: result.explanation,
        keyFindings: result.key_findings,
        sources: result.sources,
        reasoningChain: result.reasoning_chain,
        agentsUsed: result.agents_used,
        tokensUsed: result.tokens_used,
        latencyMs,
      }),
    ]).then(persisted => {
      const failed = persisted.filter(p => p.status === 'rejected');
      if (failed.length) console.warn(`[Persist] ${failed.length} background task(s) failed`);
    });

  } catch (error) {
    next(error);
  }
}

module.exports = { verifyFactCheck };
