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
const { extractJson, repairTruncatedJson, collectUrls, stripCitations } = require('../utils/helpers');
const { searchRelevantContext } = require('./ragService');
const { queryGoogleFactCheck } = require('./factCheckService');
const { retrieveGraphContext } = require('./graphRagService');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Model tiers — use the cheapest model that can do the job
const MODELS = {
  CHEAP: 'claude-haiku-4-5-20251001',  // Haiku 4.5 — fastest, cheapest pre-processing
  SMART: 'claude-sonnet-4-6',           // Sonnet 4.6 — best accuracy for final verdict
};

// ── Agent 1: Language Detection + Claim Classification (HAIKU — ~200 tokens) ──
async function classifyClaim(content, type, tokens) {
  const res = await anthropic.messages.create({
    model: MODELS.CHEAP,
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Classify this ${type} claim AND break it into atomic verifiable sub-claims in ONE pass. Return ONLY JSON:
{"lang":"ISO 639-1 code of the claim's language (e.g. en, bn, hi, ur, ar, es, fr)","is_satire":false,"category":"politics|health|science|tech|social|other","urgency":"low|medium|high","search_query":"best English search query to verify this","search_query_native":"best search query in the SAME language as the claim (copy search_query if the claim is already English)","sub_claims":["atomic claim 1","atomic claim 2"]}
sub_claims: 1-3 atomic, independently verifiable statements. If the claim is already atomic, return it as the single element.

Claim: "${typeof content === 'string' ? content.substring(0, 500) : 'image content'}"`,
    }],
  });

  const raw = res.content.find(b => b.type === 'text')?.text || '';
  tokens.count += (res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0);

  try {
    return extractJson(raw);
  } catch {
    return { lang: 'en', is_satire: false, category: 'other', urgency: 'medium', search_query: content?.substring(0, 100), sub_claims: [content] };
  }
}

// ── Agent 2: Image Content Extraction (HAIKU for cost, Vision capable) ───────
async function extractImageInfo(imageBlock, tokens) {
  const res = await anthropic.messages.create({
    model: MODELS.CHEAP,
    max_tokens: 650,
    messages: [{
      role: 'user',
      content: [
        imageBlock,
        {
          type: 'text',
          text: `You are an Image Content Extraction Agent. Extract all factual information from this image for fact-checking. Focus on WHAT the image says and claims, not whether the image itself is edited or manipulated. Return ONLY JSON:
{"is_satirical":false,"satirical_reason":null,"lang":"ISO 639-1 code of the visible text's language (e.g. en, bn, hi, ar)","visible_text":"ALL text verbatim, preserve Bengali (বাংলা)","people":"names","location":"place","date_clues":"dates","tone":"alarming|propaganda|misleading|satire|meme|neutral","source":"logos/watermarks","key_claim":"core factual claim","search_query":"English search query to verify","search_query_native":"search query in the SAME language as the visible text (copy search_query if it is English)","sub_claims":["atomic claim 1","atomic claim 2"]}
sub_claims: 1-3 atomic, independently verifiable statements from the image. If there is a single claim, return it as the one element.`
        }
      ]
    }],
  });

  const raw = res.content.find(b => b.type === 'text')?.text || '';
  tokens.count += (res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0);
  return extractJson(raw);
}

// ── Agent 3: Claim Decomposition — MERGED into Agent 1 (classifyClaim) for
// text and Agent 2 (extractImageInfo) for images, so a single Haiku call now
// returns both the classification and the atomic sub-claims. This removed one
// LLM round-trip per verification (lower tokens + lower latency).

// ── Agent 4: Evidence Gathering + Verdict (SONNET — web search) ─────────────
// Two INDEPENDENT controls so we never trade away freshness for cost:
//   • skipWebSearch — only true when we already have a strong Google Fact Check
//     match. Anything uncertain (not in RAG/GraphRAG, or only loosely matched)
//     keeps web search ON so recent events are still verified against the web.
//   • useCheapModel — use Haiku instead of Sonnet for cost. Can be true while
//     web search is still ON (e.g. GraphRAG gave supporting context but the
//     specific claim still needs fresh web verification).
async function searchAndVerdict(userContent, ragContext, factCheckContext, trustContext, graphRagContext, language, skipWebSearch = false, useCheapModel = false, persona = 'General Public', tokens = { count: 0 }) {
  // Output language follows the claim's language (or the UI override) so the tool
  // is globally usable. The verdict VALUE stays English because the frontend and
  // normalizeVerdictCode key colours/TTS off "Likely True"/"Likely False"/"Uncertain".
  const LANG_NAMES = {
    bn: 'Bangla (বাংলা)', hi: 'Hindi (हिन्दी)', ur: 'Urdu (اردو)', ar: 'Arabic (العربية)',
    es: 'Spanish (Español)', fr: 'French (Français)', pt: 'Portuguese', id: 'Indonesian',
    ta: 'Tamil (தமிழ்)', ne: 'Nepali (नेपाली)', tr: 'Turkish', ru: 'Russian (Русский)',
  };
  const langInstruction = (language && language !== 'en')
    ? `\nIMPORTANT: Write ALL human-readable text — explanation, key_findings, reasoning_chain, literacy_tip — in ${LANG_NAMES[language] || "the SAME language the user's claim is written in"}. Keep the JSON keys in English, and keep the "verdict" value EXACTLY one of: Likely True, Likely False, Uncertain. Be terse — non-English scripts use more tokens.`
    : '';

  let personaInstruction = '';
  if (persona === 'Youth/Student') {
    personaInstruction = '\nPERSONA = Youth/Student: Keep the explanation simple, educational, and easy to understand. Focus on digital literacy.';
  } else if (persona === 'Journalist') {
    personaInstruction = '\nPERSONA = Journalist: Provide high-density facts, source credibility breakdowns, and dense evidence.';
  }

  const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // When web search is skipped, the model has NO live data — so it must not fall
  // back on its own (pre-cutoff) training knowledge about the current state of the
  // world. Otherwise stale facts like "X is the current president" get asserted
  // confidently long after they stop being true.
  const searchDirective = skipWebSearch
    ? 'Do NOT search the web. Base your verdict ONLY on the EXISTING FACT-CHECKS below. Do NOT use your own training knowledge of current events, who currently holds any office, whether a person is alive, or what today\'s date implies — you cannot know those without searching. If the fact-checks do not directly resolve THIS claim, return "Uncertain".'
    : 'Do ONE web search to verify the claim against current sources.';

  const SYSTEM = `You are Poirot, an elite fact-checker. Be precise and conservative. Today's date is ${todayStr}.${langInstruction}${personaInstruction}

${searchDirective}
Output ONLY JSON:
{"verdict":"Likely True"|"Likely False"|"Uncertain","confidence":0-100,"explanation":"2-3 SHORT sentences citing the key evidence","key_findings":["finding1","finding2"],"sources":["url1","url2"],"bias_flags":[],"reasoning_chain":["step1","step2"],"literacy_tip":"1 short tip to spot this kind of misinformation"}

Rules:
- "Likely True" → Confirmed by reliable sources
- "Likely False" → Contradicted, reused/out-of-context, fabricated
- "Uncertain" → Insufficient evidence. Never guess.
- POLARITY: a fact-check's rating applies to ITS OWN wording — map it to THIS claim's wording, watching negations. A debunking fact-check EXISTING does NOT make the claim true. If a reputable check rates a claim meaning the SAME as this one false/fake/misleading/"pants on fire", this claim is "Likely False"; if rated true/correct/accurate, "Likely True". E.g. claim "the Moon landing is fake/a hoax" is "Likely False" when fact-checkers confirm the landing really happened.
- BE CONCISE. Keep the whole JSON under ~180 words so it is never cut off. explanation ≤ 3 sentences, key_findings ≤ 3 items, reasoning_chain ≤ 3 brief steps. In Bangla, be especially terse — Bangla uses far more tokens.
${ragContext ? '\n=== KNOWLEDGE BASE CONTEXT ===\n' + ragContext + '\n===' : ''}
${graphRagContext ? '\n=== GRAPH RAG CONTEXT ===\n' + graphRagContext + '\n===' : ''}
${factCheckContext || ''}
${trustContext || ''}`;

  const messages = [{ role: 'user', content: userContent }];
  let collectedUrls = [];

  for (let i = 0; i < 2; i++) {
    const isLastIteration = i === 1;
    const response = await anthropic.messages.create({
      model: useCheapModel ? MODELS.CHEAP : MODELS.SMART,
      max_tokens: 1600,
      system: SYSTEM,
      tools: skipWebSearch ? undefined : [{ type: 'web_search_20250305', name: 'web_search' }],
      ...(skipWebSearch || isLastIteration ? { tool_choice: { type: 'none' } } : {}),
      messages,
    });

    tokens.count += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
    collectedUrls = collectedUrls.concat(collectUrls(response.content));

    // Extract text from this response (works for end_turn AND max_tokens)
    const responseText = response.content.filter(b => b.type === 'text').map(b => b.text).join('');

    if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
      if (responseText) {
        return { text: responseText, urls: collectedUrls };
      }
    }

    messages.push({ role: 'assistant', content: response.content });
    const toolUses = response.content.filter(b => b.type === 'tool_use');
    if (!toolUses.length) {
      // No more tool calls — return whatever text we have rather than empty string
      if (responseText) {
        return { text: responseText, urls: collectedUrls };
      }
      break;
    }

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
function satiricalResult(explanation, finding, reasoning, agents, t0, language, tokens) {
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
    tokens_used: tokens.count,
    latency_ms: Date.now() - t0,
    language,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR — coordinates all agents
// ══════════════════════════════════════════════════════════════════════════
async function orchestrate({ type, content, base64, imageBlock, persona, language: languageOverride }) {
  const tokens = { count: 0 };
  const t0 = Date.now();
  const agents = [];

  let classification = null;
  let extracted = null;
  let language = 'en';
  // Explicit UI language ('en'/'bn') wins over auto-detection everywhere,
  // including the satire early-exits below. 'auto'/absent keeps detection.
  const hasLangOverride = languageOverride === 'bn' || languageOverride === 'en';

  let subClaims = [];
  let ragContext = '';
  let graphRagContext = '';
  // Google Fact Check is fired in parallel with preprocessing using a best-effort
  // seed query; `parallelFcSeed` is what it was queried with so we can decide later
  // whether a refined-query retry is worthwhile.
  let factChecksParallel = [];
  let parallelFcSeed = '';

  // ── Step 1 & 3: Preprocess and Retrieve in Parallel ─────────────────────
  if (type === 'image' && imageBlock) {
    // Images: the vision extractor handles satire, the core claim, visible text,
    // and (via its language) detection. Run it FIRST to extract text content.
    try {
      extracted = await extractImageInfo(imageBlock, tokens);
      agents.push('image_extractor');
      console.log(`[Agent:Extract] ${Date.now() - t0}ms`);

      if (extracted?.is_satirical) {
        return satiricalResult(
          extracted.satirical_reason || 'Satirical/meme content detected.',
          'Image identified as satire or meme content',
          'Image classified as satirical by vision agent',
          agents, t0, hasLangOverride ? languageOverride : (extracted.lang || detectLanguage(extracted.visible_text)), tokens
        );
      }
      language = extracted?.lang || detectLanguage(extracted?.visible_text);
    } catch (e) {
      console.error('[Agent:Extract] Failed:', e.message);
    }

    // Sub-claims now come straight from the vision extractor (one fewer LLM call).
    // Query RAG, GraphRAG, and Google Fact Check in parallel against the extracted
    // claim — all three are independent (free DB + free API).
    const textContent = extracted?.key_claim || content;
    parallelFcSeed = (extracted?.search_query || textContent || '').toString().substring(0, 200);
    const [ragRes, graphRes, fcRes] = await Promise.all([
      searchRelevantContext(textContent),
      retrieveGraphContext(textContent.substring(0, 300)),
      queryGoogleFactCheck(parallelFcSeed),
    ]);

    subClaims = Array.isArray(extracted?.sub_claims) && extracted.sub_claims.length
      ? extracted.sub_claims.slice(0, 3)
      : [textContent];
    ragContext = ragRes;
    graphRagContext = graphRes;
    factChecksParallel = fcRes;
    if (subClaims.length > 1) agents.push('decomposer');
  } else {
    // Text: Run classification, claim decomposition, RAG, and GraphRAG all in parallel.
    // This removes multiple sequential round-trips to the LLM and the database.
    parallelFcSeed = (content || '').substring(0, 200);
    const [classRes, ragRes, graphRes, fcRes] = await Promise.all([
      classifyClaim(content, type, tokens),
      searchRelevantContext(content),
      retrieveGraphContext(content.substring(0, 300)),
      queryGoogleFactCheck(parallelFcSeed),
    ]);

    classification = classRes;
    subClaims = Array.isArray(classRes.sub_claims) && classRes.sub_claims.length
      ? classRes.sub_claims.slice(0, 3)
      : [content];
    ragContext = ragRes;
    graphRagContext = graphRes;
    factChecksParallel = fcRes;

    agents.push('classifier');
    if (subClaims.length > 1) agents.push('decomposer');

    language = hasLangOverride ? languageOverride : (classification.lang || 'en');
    console.log(`[Agent:ParallelPreprocess] ${Date.now() - t0}ms`, JSON.stringify(classification));

    if (classification.is_satire) {
      return satiricalResult(
        language === 'bn'
          ? 'এটি ব্যঙ্গাত্মক বা মিম কন্টেন্ট হিসেবে চিহ্নিত করা হয়েছে।'
          : 'Content identified as satire or humor, not a factual claim.',
        'Content identified as satire/humor',
        'Classified as satirical content by pre-processor',
        agents, t0, language, tokens
      );
    }
  }

  // Catch the image non-satire path too (the satire exits already applied it).
  // Only steers the verdict prompt + returned language — never routing.
  if (hasLangOverride) language = languageOverride;

  // Step 4: Build the prompt for verdict agent
  const promptParts = [];

  if (extracted) {
    const enQuery = extracted.search_query || extracted.key_claim;
    const nativeQuery = extracted.search_query_native;
    const lines = [
      '=== IMAGE CONTENT ANALYSIS ===',
      `Text: ${extracted.visible_text || 'None'}`,
      `People: ${extracted.people || 'None'}`,
      `Location: ${extracted.location || 'Unknown'}`,
      `Date Clues: ${extracted.date_clues || 'None'}`,
      `Tone: ${extracted.tone || 'Neutral'}`,
      `Source: ${extracted.source || 'None'}`,
      `Key Claim: ${extracted.key_claim || 'Unknown'}`,
      subClaims.length > 1 ? `Sub-claims: ${subClaims.join(' | ')}` : '',
      `\nTo verify, search the web. For internationally-reported topics, search in English: "${enQuery}".${nativeQuery && nativeQuery !== enQuery ? ` If the claim is local or regional, ALSO search in its original language: "${nativeQuery}".` : ''}`,
    ].filter(Boolean);
    promptParts.push({ type: 'text', text: lines.join('\n') });
  } else if (imageBlock) {
    promptParts.push(imageBlock);
    promptParts.push({ type: 'text', text: `Fact-check this image. Search the web to verify it.` });
  } else {
    const claimText = subClaims.length > 1
      ? `Verify these related claims:\n${subClaims.map((c, i) => `${i + 1}. "${c}"`).join('\n')}`
      : `Verify: "${content}"`;
    // Locality-aware search: English maximises coverage for internationally-
    // reported topics, but LOCAL/regional claims (e.g. Bangladeshi news, local
    // people/places) are often only covered in the original language — so tell
    // the agent to use English for global topics and the claim's own language
    // for local ones. (Output language is handled separately by langInstruction.)
    const enQuery = classification?.search_query;
    const nativeQuery = classification?.search_query_native;
    const searchHint = enQuery
      ? `\nTo verify, search the web. For internationally-reported topics, search in English: "${enQuery}".${nativeQuery && nativeQuery !== enQuery ? ` If the claim is local or regional, ALSO search in its original language: "${nativeQuery}" — to reach primary local sources.` : ''}`
      : '';
    promptParts.push({ type: 'text', text: claimText + searchHint });
  }

  // ── Step 4b: Context retrieval — runs AFTER we know the real claim ───────
  // For images this queries the extracted key_claim (not the useless image URL),
  // and uses the optimized English search_query for Google Fact Check. The three
  // lookups are independent (free DB + API), so fan them out in parallel.
  const retrievalText = (extracted?.key_claim || content || '').toString().substring(0, 500);
  const factCheckQuery = (classification?.search_query || extracted?.search_query || retrievalText).toString().substring(0, 200);

  // Google Fact Check already ran in parallel with preprocessing using a best-effort
  // seed query. If that came up empty, retry once with the LLM-refined English search
  // query (better recall for Bangla/non-English claims). The API is free → no tokens.
  let existingFactChecks = factChecksParallel || [];
  if (existingFactChecks.length === 0 && factCheckQuery && factCheckQuery !== parallelFcSeed) {
    existingFactChecks = await queryGoogleFactCheck(factCheckQuery);
  }

  let factCheckContext = '';
  if (existingFactChecks.length > 0) {
    console.log(`[FactCheck] ${existingFactChecks.length} existing result(s)`);
    factCheckContext = '\n=== EXISTING FACT-CHECKS ===\n' +
      existingFactChecks.map((fc, i) => `${i + 1}. "${fc.claim}" → ${fc.rating} (${fc.publisher})`).join('\n') + '\n===';
  }
  const trustContext = ''; // populated post-verdict by the trust scoring service
  if (graphRagContext) console.log('[GraphRAG] Found semantic relationships');

  // Step 4.5: 9Router-inspired Token Optimization
  //
  // The verdict ALWAYS runs on Haiku now: ~3x cheaper than Sonnet, much faster,
  // and it keeps the round-trip under Chrome's 30s service-worker limit. Web
  // search stays ON for freshness by default. We ONLY skip it on a strong Google
  // Fact Check match AND when the claim is not time-sensitive — otherwise a stale
  // fact-check (or the model's pre-cutoff training knowledge) silently goes wrong
  // as the world changes (e.g. who currently holds an office, who is alive).
  const hasStrongFactCheck = factCheckContext && factCheckContext.includes('EXISTING FACT-CHECKS');
  const freshnessText = (content || extracted?.key_claim || extracted?.visible_text || '').toString().toLowerCase();
  const timeSensitive =
    classification?.category === 'politics' ||
    /\b(president|prime minister|\bpm\b|chancellor|minister|ceo|leader|king|queen|champion|current|currently|now|today|still|this year|in office|holds office|alive|dead|died|resign|elected|winner|incumbent|latest)\b/.test(freshnessText);
  const skipWebSearch = hasStrongFactCheck && !timeSensitive;
  const useCheaperModel = true; // Haiku for the verdict by default

  agents.push(skipWebSearch ? '9router_fast_path' : '9router_cheap_model');
  console.log(`[Agent:Router] ${skipWebSearch
    ? 'Fast path: Haiku, no web search (strong, timeless fact-check match)'
    : `Haiku + web search${hasStrongFactCheck && timeSensitive ? ' (fact-check found but claim is time-sensitive → verifying live)' : ''}`}`);

  // Step 5: Verdict synthesis (HAIKU; web search unless strong fact-check)
  agents.push('verdict_synthesizer');
  const { text: rawVerdict, urls } = await searchAndVerdict(
    promptParts,
    ragContext || '',
    factCheckContext || '',
    trustContext || '',
    graphRagContext || '',
    language,
    skipWebSearch,
    useCheaperModel,
    persona,
    tokens
  );
  console.log(`[Agent:Verdict] ${Date.now() - t0}ms`);

  // Step 6: Parse result
  let result;
  try {
    result = extractJson(rawVerdict);
  } catch {
    // Log the raw response so we can debug why parsing failed
    console.warn('[Agent:Verdict] JSON parse failed. Raw response:', rawVerdict?.substring(0, 500));

    // Try to salvage useful information from non-JSON responses
    // Claude sometimes wraps JSON in disclaimers for sensitive topics,
    // or the response gets truncated at max_tokens mid-JSON
    const raw = String(rawVerdict || '');

    // Attempt to repair truncated JSON (max_tokens cutoff) — closes any
    // string/array/object the cutoff left open so we keep the real verdict.
    result = repairTruncatedJson(raw);

    if (!result) {
      // Extract what we can from the raw text
      const verdictMatch = raw.match(/(?:likely\s+true|likely\s+false|uncertain)/i);
      const confMatch = raw.match(/confidence["\s:]+(\d+)/i);
      result = {
        verdict: verdictMatch ? verdictMatch[0].replace(/\b\w/g, c => c.toUpperCase()) : 'Uncertain',
        confidence: confMatch ? parseInt(confMatch[1]) : 0,
        explanation: raw.replace(/```[\s\S]*?```/g, '').replace(/[{}"\[\]]/g, '').trim().substring(0, 500) || 'Could not parse AI response.',
        key_findings: [],
        sources: [],
      };
    }
  }

  if (!result.sources?.length) result.sources = urls.slice(0, 5);

  // Step 7: Bias flags come straight from the verdict agent's JSON. Sonnet
  // already inspects the sources and framing while forming the verdict, so a
  // separate Haiku bias call was a redundant sequential round-trip (extra
  // latency + tokens) for no accuracy gain. Reuse what the verdict produced.
  const biasFlags = result.bias_flags || [];
  if (biasFlags.length > 0) agents.push('bias_detector');

  // Canonical TEXT representation of the claim for self-learning (RAG) and graph
  // building. For images this is the EXTRACTED info (key claim, visible text,
  // people, place, date) — never the base64 pixels — so a future *similar* claim
  // can hit this grounding even if the image itself differs.
  const claimText = extracted
    ? [
        extracted.key_claim,
        extracted.visible_text,
        extracted.people && `People: ${extracted.people}`,
        extracted.location && `Location: ${extracted.location}`,
        extracted.date_clues && `Date: ${extracted.date_clues}`,
      ].filter(Boolean).join('. ').substring(0, 1000)
    : (content || '');

  return {
    claim_text: claimText,
    verdict: result.verdict,
    confidence: result.confidence || 0,
    explanation: stripCitations(result.explanation || ''),
    key_findings: stripCitations(result.key_findings || []),
    sources: result.sources || [],
    trust_score: null, // Will be filled by trust scoring service
    bias_flags: biasFlags,
    reasoning_chain: stripCitations(result.reasoning_chain || []),
    literacy_tip: result.literacy_tip || 'Always verify the source and look for multiple independent confirmations.',
    agents_used: agents,
    tokens_used: tokens.count,
    latency_ms: Date.now() - t0,
    language,
    search_query: classification?.search_query || extracted?.search_query,
  };
}

module.exports = {
  orchestrate,
  extractImageInfo,
  classifyClaim,
  searchAndVerdict,
};
