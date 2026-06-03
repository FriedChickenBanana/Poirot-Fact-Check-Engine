const crypto = require('crypto');
const { buildImageBlock, extractJson } = require('../utils/helpers');
const { orchestrate } = require('../services/agentOrchestrator');
const { getCached, setCached } = require('../services/cacheService');
const { learnFromVerification } = require('../services/ragService');
const { saveToGraph } = require('../services/graphRagService');
const { computeTrustScore, updateSourceProfile } = require('../services/trustScoringService');
const { logVerification } = require('../services/analyticsService');

// ── Language / verdict helpers (adopted from the reference backend, de-duped) ──
const BANGLA_FALLBACK = {
  explanation: 'বাংলা আউটপুট পাওয়া যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।',
  finding: 'বাংলা ব্যাখ্যা পাওয়া যায়নি।',
};

// Caller's explicit language choice: 'en' | 'bn', or null for Auto (let the
// orchestrator auto-detect). Reads either `language` or `uiLanguage`.
function resolveLanguageOverride(body) {
  const v = (body.language || body.uiLanguage || '').toLowerCase();
  return v === 'bn' || v === 'en' ? v : null;
}

// Stable language tag for the cache key so EN / BN / Auto cache separately.
function cacheLanguage(body) {
  return resolveLanguageOverride(body) || 'auto';
}

// Map any verdict string (English or Bangla) to a machine-readable code the
// frontend keys colours / text-to-speech off.
function normalizeVerdictCode(verdict) {
  const v = (verdict || '').toLowerCase();
  if (v.includes('satir') || v.includes('ব্যঙ্গ')) return 'satirical';
  if (v.includes('false') || v.includes('মিথ্যা')) return 'false';
  if (v.includes('true') || v.includes('সত্য')) return 'true';
  if (v.includes('error') || v.includes('ত্রুটি')) return 'error';
  return 'uncertain';
}

// Bangla safety net — NON-DESTRUCTIVE by design: it never overrides a real
// verdict, confidence, sources, or findings just because text came back in the
// wrong language (that would cost accuracy). The verdict prompt already requests
// Bangla when bn is selected; this only fills a Bangla notice if the explanation
// is genuinely empty.
function enforceBanglaOutput(result) {
  const hasExplanation = (result.explanation || '').trim().length > 0;
  if (hasExplanation) return result;
  return {
    ...result,
    explanation: BANGLA_FALLBACK.explanation,
    key_findings: (result.key_findings && result.key_findings.length)
      ? result.key_findings
      : [BANGLA_FALLBACK.finding],
  };
}

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

    // Caller's language preference: explicit 'en'/'bn' steers the verdict prompt
    // and triggers Bangla enforcement; 'auto'/absent keeps auto-detection.
    const langOverride = resolveLanguageOverride(req.body);
    const cacheOpts = { language: cacheLanguage(req.body) };

    // ── Step 0: Cache check (Token Optimization) ────────────────────────
    let cacheKey = safeContent;
    if (type === 'image' && base64) {
      // Hash the base64 to ensure we don't re-process the same image pixels
      cacheKey = crypto.createHash('sha256').update(base64).digest('hex');
    }

    const cached = await getCached(type, cacheKey, cacheOpts);
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
    let result = await orchestrate({
      type,
      content: queryContent,
      base64,
      imageBlock,
      persona,
      language: langOverride,
    });

    // ── Step 5.5: Frontend contract — machine-readable verdict code, and a
    // Bangla safety net when the caller explicitly asked for Bangla. ────────
    result.verdict_code = normalizeVerdictCode(result.verdict);
    if (langOverride === 'bn') {
      result = enforceBanglaOutput(result);
    }

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
    // Learn from the canonical CLAIM TEXT, not the raw request: image requests
    // have no `content`, so the orchestrator hands back `claim_text` built from
    // the vision extraction (key claim, visible text, people, place). This is
    // why images previously saved nothing / failed graph extraction.
    const learnText = (result.claim_text || safeContent || '').substring(0, 1000);
    Promise.allSettled([
      updateSourceProfile(result.sources, result.verdict),
      learnText ? learnFromVerification(learnText.substring(0, 500), result.verdict, result.sources) : Promise.resolve(),
      setCached(type, cacheKey, result, cacheOpts),
      (learnText && (result.verdict === 'Likely True' || result.verdict === 'Likely False'))
        ? saveToGraph(learnText, result.sources?.[0])
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
