const { buildImageBlock, extractJson } = require('../utils/helpers');
const { extractImageInfo, searchAndVerdict } = require('../services/anthropicService');
const { getCached, setCached } = require('../services/cacheService');
const { queryGoogleFactCheck } = require('../services/factCheckService');

async function verifyFactCheck(req, res, next) {
  const t0 = Date.now();
  try {
    const { type, content } = req.body;
    if (!content) {
      return res.status(400).json({ verdict: 'Error', explanation: 'No content provided.' });
    }

    // ── Step 0: Redis cache check ──────────────────────────────────────────
    // For images, cache by srcUrl (content field); for text, cache by the text itself.
    const cached = await getCached(type, content);
    if (cached) {
      console.log(`[Cache HIT] ${Date.now() - t0}ms`);
      return res.json({ ...cached, cached: true });
    }

    // ── Step 1: Parse image block ──────────────────────────────────────────
    const imageBlock = type === 'image' ? buildImageBlock(req.body.base64) : null;
    let extracted = null;

    // ── Step 2: Extract image info ─────────────────────────────────────────
    if (type === 'image' && imageBlock) {
      try {
        extracted = await extractImageInfo(imageBlock);
        console.log(`[Extract] ${Date.now() - t0}ms`, JSON.stringify(extracted, null, 2));
      } catch (e) {
        console.error('[Extract] Failed:', e.message);
      }
    }

    // ── Early exit: Satirical / Meme content ──────────────────────────────
    if (extracted?.is_satirical) {
      const satiricalResult = {
        verdict: 'Satirical',
        confidence: 90,
        explanation: `This appears to be satirical or meme content. ${extracted.satirical_reason || ''}`.trim(),
        key_findings: ['Content identified as satire or humor, not a factual claim.'],
        sources: []
      };
      await setCached(type, content, satiricalResult);
      return res.json(satiricalResult);
    }

    // ── Step 3a: Determine Google Fact Check query ─────────────────────────
    // Images: use the extracted key claim; text: use the raw content.
    const factCheckQuery = extracted
      ? (extracted.search_query || extracted.key_claim || content)
      : content;

    // ── Step 3b: Google Fact Check API lookup ─────────────────────────────
    const existingFactChecks = await queryGoogleFactCheck(factCheckQuery);
    if (existingFactChecks.length > 0) {
      console.log(`[FactCheck] ${existingFactChecks.length} result(s) found`);
    }

    // ── Step 3c: Build fact-check context block ───────────────────────────
    const factCheckSection = existingFactChecks.length > 0
      ? '\n=== EXISTING FACT-CHECKS (Google Fact Check Tools) ===\n' +
        existingFactChecks.map((fc, i) =>
          `${i + 1}. Claim: "${fc.claim}" | Rating: ${fc.rating} | Source: ${fc.publisher} | URL: ${fc.url}`
        ).join('\n') +
        '\nUse these as grounding evidence alongside your web search.\n==='
      : '';

    // ── Step 3d: Build Claude prompt ──────────────────────────────────────
    const promptParts = [];

    const chainOfThoughtInstructions = [
      'To ensure accuracy, follow these steps before giving your final verdict:',
      '1. List the entities and core claim.',
      '2. Evaluate the evidence from the search results.',
      '3. Identify any logical fallacies or manipulated context.',
      '4. Output your final verdict strictly as a JSON object wrapped inside a ```json ... ``` codeblock.'
    ].join('\\n');

    const oneShotJsonInstructions = 'Then verify whether this claim is true or false and strictly output your final verdict as a JSON object wrapped inside a ```json ... ``` codeblock.';

    let promptText;
    if (extracted) {
      const lines = [
        '=== IMAGE ANALYSIS ===',
        `Visible Text (verbatim, preserve Bengali script): ${extracted.visible_text || 'None'}`,
        `People: ${extracted.people || 'None'}`,
        `Location: ${extracted.location || 'Unknown'}`,
        `Date Clues: ${extracted.date_clues || 'None'}`,
        `Tone: ${extracted.tone || 'Neutral'}`,
        `Source Indicators: ${extracted.source || 'None'}`,
        `Manipulation: ${extracted.manipulation || 'None detected'}`,
        `Key Claim: ${extracted.key_claim || 'Unknown'}`,
        factCheckSection,
        '',
        `Search the web using this query: "${extracted.search_query || extracted.key_claim}"`,
        oneShotJsonInstructions
      ];
      promptText = lines.join('\\n');
    } else if (imageBlock) {
      // Fallback if extraction failed
      promptParts.push(imageBlock);
      promptText = `Fact-check this image. Search the web to verify it. ${oneShotJsonInstructions}`;
    } else {
      promptText = `Fact-check the following claim:\\n\\n"${content}"\\n\\nSearch the web to verify this claim.\\n${factCheckSection}\\n\\n${chainOfThoughtInstructions}`;
    }

    promptParts.push({ type: 'text', text: promptText });

    // ── Step 4: Web search + verdict ──────────────────────────────────────
    const { text: rawVerdict, urls } = await searchAndVerdict(promptParts);
    console.log(`[Done] ${Date.now() - t0}ms`);

    // ── Parse result ───────────────────────────────────────────────────────
    let result;
    try {
      result = extractJson(rawVerdict);
    } catch {
      result = { verdict: 'Uncertain', confidence: 0, explanation: 'Could not parse response.', key_findings: [], sources: [] };
    }

    if (!result.sources?.length) result.sources = urls.slice(0, 3);

    // ── Step 5: Cache result in Redis ─────────────────────────────────────
    await setCached(type, content, result);

    res.json(result);

  } catch (error) {
    next(error);
  }
}

module.exports = { verifyFactCheck };
