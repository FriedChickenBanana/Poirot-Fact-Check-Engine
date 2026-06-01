// ══════════════════════════════════════════════════════════════════════════
// AGENT ORCHESTRATOR — Multi-agent pipeline with token optimization
//
// Cost optimization strategy:
//   1. Haiku 4.5 for cheap tasks: language detection, satire check, claim decomposition
//   2. Google Fact Check API first (FREE) — skip LLM if strong match
//   3. Sonnet 4.6 ONLY for final verdict synthesis with web search
//   4. Aggressive Redis caching + semantic deduplication
//   5. Compressed prompts — every token counts
//   6. Strict max_tokens limits per agent
//
// Token cost comparison (per 1M tokens):
//   Haiku 4.5:  Input $1.00  / Output $5.00
//   Sonnet 4.6: Input $3.00  / Output $15.00
//   → Haiku is ~3x cheaper. Use it for all pre-processing.
// ══════════════════════════════════════════════════════════════════════════

const { Anthropic } = require('@anthropic-ai/sdk');
const { extractJson, collectUrls } = require('../utils/helpers');
const { searchRelevantContext } = require('./ragService');
const { queryGoogleFactCheck } = require('./factCheckService');
const { retrieveGraphContext } = require('./graphRagService');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Model tiers — use the cheapest model that can do the job
const MODELS = {
  CHEAP: 'claude-haiku-4-5-20251001',  // Haiku 4.5 — fastest, cheapest pre-processing
  SMART: 'claude-sonnet-4-6',           // Sonnet 4.6 — best accuracy for final verdict
};

let totalTokensUsed = 0;

// ── Agent 1: Language Detection + Claim Classification (HAIKU — ~200 tokens) ──
async function classifyClaim(content, type) {
  const res = await anthropic.messages.create({
    model: MODELS.CHEAP,
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Classify this ${type} claim. Return ONLY JSON:
{"lang":"en|bn|hi|other","is_satire":false,"category":"politics|health|science|tech|social|other","urgency":"low|medium|high","search_query":"best English search query to verify this"}

Claim: "${typeof content === 'string' ? content.substring(0, 500) : 'image content'}"`,
    }],
  });

  const raw = res.content.find(b => b.type === 'text')?.text || '';
  totalTokensUsed += (res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0);

  try {
    return extractJson(raw);
  } catch {
    return { lang: 'en', is_satire: false, category: 'other', urgency: 'medium', search_query: content?.substring(0, 100) };
  }
}

// ── Agent 2: Image Extraction (HAIKU for cost, Vision capable) ──────────────
async function extractImageInfo(imageBlock) {
  const res = await anthropic.messages.create({
    model: MODELS.CHEAP,
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: [
        imageBlock,
        {
          type: 'text',
          text: `You are a Deepfake Forensics Agent. Analyze this image for fact-checking and manipulation. Return ONLY JSON:
{"is_satirical":false,"satirical_reason":null,"visible_text":"ALL text verbatim, preserve Bengali (বাংলা)","people":"names","location":"place","date_clues":"dates","tone":"alarming|propaganda|misleading|satire|meme|neutral","source":"logos/watermarks","manipulation":"Generative AI footprint detected, AI Watermark, Deepfake artifacts, or None detected","deepfake_probability":0-100,"forensic_flags":["flag1","flag2"],"key_claim":"core factual claim","search_query":"English search query to verify"}`
        }
      ]
    }],
  });

  const raw = res.content.find(b => b.type === 'text')?.text || '';
  totalTokensUsed += (res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0);
  return extractJson(raw);
}

// ── Agent 3: Claim Decomposition (HAIKU — for complex claims) ───────────────
async function decomposeClaimIfComplex(content) {
  // Only decompose if content is long (>200 chars) — saves tokens on simple claims
  if (content.length < 200) {
    return [content];
  }

  const res = await anthropic.messages.create({
    model: MODELS.CHEAP,
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Break this into 1-3 atomic verifiable sub-claims. Return ONLY a JSON array of strings.
If it's already a single claim, return ["original claim"].

Claim: "${content.substring(0, 800)}"`,
    }],
  });

  const raw = res.content.find(b => b.type === 'text')?.text || '';
  totalTokensUsed += (res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0);

  try {
    const parsed = JSON.parse(raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim());
    return Array.isArray(parsed) ? parsed.slice(0, 3) : [content];
  } catch {
    return [content];
  }
}

// ── Agent 4: Evidence Gathering + Verdict (SONNET — web search) ─────────────
// This is the ONLY agent that uses the expensive model, because it needs web search (unless useFastModel is true)
async function searchAndVerdict(userContent, ragContext, factCheckContext, trustContext, graphRagContext, language, useFastModel = false, persona = 'General Public') {
  const langInstruction = language === 'bn'
    ? '\nProvide your explanation in Bangla (বাংলা) language.'
    : '';

  let personaInstruction = '';
  if (persona === 'Youth/Student') {
    personaInstruction = '\nPERSONA = Youth/Student: Keep the explanation simple, educational, and easy to understand. Focus on digital literacy.';
  } else if (persona === 'Journalist') {
    personaInstruction = '\nPERSONA = Journalist: Provide high-density facts, source credibility breakdowns, and dense evidence.';
  }

  const SYSTEM = `You are Poirot, an elite fact-checker. Be precise and conservative.${langInstruction}${personaInstruction}

Do ONE web search, then output ONLY JSON:
{"verdict":"Likely True"|"Likely False"|"Uncertain","confidence":0-100,"explanation":"3-5 lines with evidence tailored to the persona","key_findings":["finding1","finding2"],"sources":["url1","url2"],"bias_flags":[],"reasoning_chain":["step1","step2"],"literacy_tip":"1 short, actionable tip on how to spot this type of misinformation or manipulation in the future (tailored to the persona)"}

Rules:
- "Likely True" → Confirmed by reliable sources
- "Likely False" → Contradicted, reused/out-of-context, fabricated
- "Uncertain" → Insufficient evidence. Never guess.
${ragContext ? '\n=== KNOWLEDGE BASE CONTEXT ===\n' + ragContext + '\n===' : ''}
${graphRagContext ? '\n=== GRAPH RAG CONTEXT ===\n' + graphRagContext + '\n===' : ''}
${factCheckContext || ''}
${trustContext || ''}`;

  const messages = [{ role: 'user', content: userContent }];
  let collectedUrls = [];

  for (let i = 0; i < 2; i++) {
    const isLastIteration = i === 1;
    const response = await anthropic.messages.create({
      model: useFastModel ? MODELS.CHEAP : MODELS.SMART,
      max_tokens: 800,
      system: SYSTEM,
      tools: useFastModel ? undefined : [{ type: 'web_search_20250305', name: 'web_search' }],
      ...(useFastModel || isLastIteration ? { tool_choice: { type: 'none' } } : {}),
      messages,
    });

    totalTokensUsed += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
    collectedUrls = collectedUrls.concat(collectUrls(response.content));

    if (response.stop_reason === 'end_turn') {
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      return { text, urls: collectedUrls };
    }

    messages.push({ role: 'assistant', content: response.content });
    const toolUses = response.content.filter(b => b.type === 'tool_use');
    if (!toolUses.length) break;

    const searchResults = response.content.filter(b => b.type === 'web_search_tool_result');
    messages.push({
      role: 'user',
      content: toolUses.map(tu => {
        const matched = searchResults.find(r => r.tool_use_id === tu.id);
        return { type: 'tool_result', tool_use_id: tu.id, content: matched?.content ?? '' };
      }),
    });
  }

  return { text: '', urls: collectedUrls };
}

// ── Quick script-based language detection — Bengali Unicode block → 'bn' ────
function detectLanguage(text) {
  return /[ঀ-৿]/.test(text || '') ? 'bn' : 'en';
}

// ── Shared shape for early satire exits ────────────────────────────────────
function satiricalResult(explanation, finding, reasoning, agents, t0, language) {
  return {
    verdict: 'Satirical',
    confidence: 90,
    explanation,
    key_findings: [finding],
    sources: [],
    trust_score: null,
    bias_flags: [],
    reasoning_chain: [reasoning],
    agents_used: agents,
    tokens_used: totalTokensUsed,
    latency_ms: Date.now() - t0,
    language,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR — coordinates all agents
// ══════════════════════════════════════════════════════════════════════════
async function orchestrate({ type, content, base64, imageBlock, persona }) {
  totalTokensUsed = 0;
  const t0 = Date.now();
  const agents = [];

  let classification = null;
  let extracted = null;
  let language = 'en';

  // ── Step 1: Preprocess by type ──────────────────────────────────────────
  if (type === 'image' && imageBlock) {
    // Images: the vision extractor handles satire, the core claim, visible text,
    // and (via its language) detection. Run it FIRST and skip the text
    // classifier — classifying the image URL was wasted work and mis-detected
    // language (Step 2 of the old flow ran AFTER a useless classify call).
    try {
      extracted = await extractImageInfo(imageBlock);
      agents.push('image_extractor');
      console.log(`[Agent:Extract] ${Date.now() - t0}ms`);

      if (extracted?.is_satirical) {
        return satiricalResult(
          extracted.satirical_reason || 'Satirical/meme content detected.',
          'Image identified as satire or meme content',
          'Image classified as satirical by vision agent',
          agents, t0, detectLanguage(extracted.visible_text)
        );
      }
      language = detectLanguage(extracted?.visible_text);
    } catch (e) {
      console.error('[Agent:Extract] Failed:', e.message);
    }
  } else {
    // Text: classify language, satire, category, and an optimized search query.
    classification = await classifyClaim(content, type);
    agents.push('classifier');
    language = classification.lang || 'en';
    console.log(`[Agent:Classify] ${Date.now() - t0}ms`, JSON.stringify(classification));

    if (classification.is_satire) {
      return satiricalResult(
        language === 'bn'
          ? 'এটি ব্যঙ্গাত্মক বা মিম কন্টেন্ট হিসেবে চিহ্নিত করা হয়েছে।'
          : 'Content identified as satire or humor, not a factual claim.',
        'Content identified as satire/humor',
        'Classified as satirical content by pre-processor',
        agents, t0, language
      );
    }
  }

  // Step 3: Claim decomposition for complex claims (HAIKU — ~$0.0003)
  const textContent = extracted?.key_claim || content;
  const subClaims = await decomposeClaimIfComplex(textContent);
  if (subClaims.length > 1) agents.push('decomposer');

  // Step 4: Build the prompt for verdict agent
  const promptParts = [];

  if (extracted) {
    const lines = [
      '=== IMAGE ANALYSIS ===',
      `Text: ${extracted.visible_text || 'None'}`,
      `People: ${extracted.people || 'None'}`,
      `Location: ${extracted.location || 'Unknown'}`,
      `Tone: ${extracted.tone || 'Neutral'}`,
      `Source: ${extracted.source || 'None'}`,
      `Manipulation: ${extracted.manipulation || 'None detected'}`,
      `Deepfake Probability: ${extracted.deepfake_probability !== undefined ? extracted.deepfake_probability + '%' : 'N/A'}`,
      extracted.forensic_flags?.length ? `Forensic Flags: ${extracted.forensic_flags.join(', ')}` : '',
      `Key Claim: ${extracted.key_claim || 'Unknown'}`,
      subClaims.length > 1 ? `Sub-claims: ${subClaims.join(' | ')}` : '',
      `\nSearch: "${extracted.search_query || extracted.key_claim}"`,
    ].filter(Boolean);
    promptParts.push({ type: 'text', text: lines.join('\n') });
  } else if (imageBlock) {
    promptParts.push(imageBlock);
    promptParts.push({ type: 'text', text: `Fact-check this image. Search the web to verify it.` });
  } else {
    const claimText = subClaims.length > 1
      ? `Verify these related claims:\n${subClaims.map((c, i) => `${i + 1}. "${c}"`).join('\n')}`
      : `Verify: "${content}"`;
    promptParts.push({ type: 'text', text: claimText });
  }

  // ── Step 4b: Context retrieval — runs AFTER we know the real claim ───────
  // For images this queries the extracted key_claim (not the useless image URL),
  // and uses the optimized English search_query for Google Fact Check. The three
  // lookups are independent (free DB + API), so fan them out in parallel.
  const retrievalText = (extracted?.key_claim || textContent || '').toString().substring(0, 500);
  const factCheckQuery = (classification?.search_query || extracted?.search_query || retrievalText).toString().substring(0, 200);

  const [ragContext, existingFactChecks, graphRagContext] = await Promise.all([
    searchRelevantContext(retrievalText),
    queryGoogleFactCheck(factCheckQuery),
    retrieveGraphContext(retrievalText.substring(0, 300)),
  ]);

  let factCheckContext = '';
  if (existingFactChecks.length > 0) {
    console.log(`[FactCheck] ${existingFactChecks.length} existing result(s)`);
    factCheckContext = '\n=== EXISTING FACT-CHECKS ===\n' +
      existingFactChecks.map((fc, i) => `${i + 1}. "${fc.claim}" → ${fc.rating} (${fc.publisher})`).join('\n') + '\n===';
  }
  const trustContext = ''; // populated post-verdict by the trust scoring service
  if (graphRagContext) console.log('[GraphRAG] Found semantic relationships');

  // Step 4.5: 9Router-inspired Token Optimization
  // If we have extensive GraphRAG context or exact Google Fact Check match, we can bypass expensive web search
  const canUseFastPath = (graphRagContext && graphRagContext.includes('Evidence:')) ||
                         (factCheckContext && factCheckContext.includes('EXISTING FACT-CHECKS'));
  
  if (canUseFastPath) {
    agents.push('9router_fast_path');
    console.log(`[Agent:Router] Routing to fast path (Haiku) due to existing context`);
  }

  // Step 5: Verdict synthesis (SONNET or HAIKU based on router)
  agents.push('verdict_synthesizer');
  const { text: rawVerdict, urls } = await searchAndVerdict(
    promptParts,
    ragContext || '',
    factCheckContext || '',
    trustContext || '',
    graphRagContext || '',
    language,
    canUseFastPath,
    persona
  );
  console.log(`[Agent:Verdict] ${Date.now() - t0}ms`);

  // Step 6: Parse result
  let result;
  try {
    result = extractJson(rawVerdict);
  } catch {
    result = {
      verdict: 'Uncertain',
      confidence: 0,
      explanation: 'Could not parse AI response.',
      key_findings: [],
      sources: [],
    };
  }

  if (!result.sources?.length) result.sources = urls.slice(0, 5);

  // Step 7: Bias flags come straight from the verdict agent's JSON. Sonnet
  // already inspects the sources and framing while forming the verdict, so a
  // separate Haiku bias call was a redundant sequential round-trip (extra
  // latency + tokens) for no accuracy gain. Reuse what the verdict produced.
  const biasFlags = result.bias_flags || [];
  if (biasFlags.length > 0) agents.push('bias_detector');

  return {
    verdict: result.verdict,
    confidence: result.confidence || 0,
    explanation: result.explanation || '',
    key_findings: result.key_findings || [],
    sources: result.sources || [],
    trust_score: null, // Will be filled by trust scoring service
    bias_flags: biasFlags,
    reasoning_chain: result.reasoning_chain || [],
    literacy_tip: result.literacy_tip || 'Always verify the source and look for multiple independent confirmations.',
    deepfake_probability: extracted ? extracted.deepfake_probability : undefined,
    forensic_flags: extracted ? extracted.forensic_flags : undefined,
    agents_used: agents,
    tokens_used: totalTokensUsed,
    latency_ms: Date.now() - t0,
    language,
    search_query: classification?.search_query || extracted?.search_query,
  };
}

module.exports = {
  orchestrate,
  extractImageInfo,
  classifyClaim,
  decomposeClaimIfComplex,
  searchAndVerdict,
};
