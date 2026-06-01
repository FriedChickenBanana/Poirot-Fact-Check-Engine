const { buildImageBlock, extractJson } = require('../utils/helpers');
const { extractImageInfo, searchAndVerdict } = require('../services/anthropicService');
const { getCached, setCached } = require('../services/cacheService');
const { queryGoogleFactCheck } = require('../services/factCheckService');
const { extractFromSocialMedia } = require('../services/socialMediaService');

const LANGUAGE_TEXT = {
  en: {
    noContent: 'No content provided.',
    satiricalExplanation: 'This appears to be satirical or meme content.',
    satiricalFinding: 'Content identified as satire or humor, not a factual claim.',
    parseError: 'Could not parse response.',
    missingBangla: 'Bangla output was not returned. Please try again.',
    missingBanglaFinding: 'No Bangla explanation was produced.'
  },
  bn: {
    noContent: 'কোনো কনটেন্ট দেওয়া হয়নি।',
    satiricalExplanation: 'এটি ব্যঙ্গাত্মক বা মিম কনটেন্ট বলে মনে হচ্ছে।',
    satiricalFinding: 'কনটেন্টটি ব্যঙ্গ/রসাত্মক হিসেবে শনাক্ত হয়েছে, এটি তথ্যভিত্তিক দাবি নয়।',
    parseError: 'রেসপন্স পার্স করা যায়নি।',
    missingBangla: 'বাংলা আউটপুট পাওয়া যায়নি। আবার চেষ্টা করুন।',
    missingBanglaFinding: 'বাংলা ব্যাখ্যা পাওয়া যায়নি।'
  }
};

function normalizeLanguage(value) {
  return value === 'bn' ? 'bn' : 'en';
}

function normalizeVerdictCode(verdict) {
  const value = (verdict || '').toLowerCase();
  if (value.includes('satir') || value.includes('ব্যঙ্গ')) return 'satirical';
  if (value.includes('false') || value.includes('মিথ্যা')) return 'false';
  if (value.includes('true') || value.includes('সত্য')) return 'true';
  if (value.includes('error') || value.includes('ত্রুটি')) return 'error';
  if (value.includes('uncertain') || value.includes('অনিশ্চিত')) return 'uncertain';
  return 'uncertain';
}

function containsBengali(text) {
  return /[\u0980-\u09FF]/.test(text || '');
}

function isBanglaText(text) {
  const value = text || '';
  const hasBengali = /[\u0980-\u09FF]/.test(value);
  const hasLatin = /[A-Za-z]/.test(value);
  if (hasLatin && !hasBengali) return false;
  return true;
}

function isSocialMediaLink(text) {
  const socialRegex = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com|facebook\.com|instagram\.com|tiktok\.com|youtube\.com|linkedin\.com|reddit\.com|threads\.net)\//i;
  return socialRegex.test(text || '');
}

function enforceBanglaOutput(result, languageText) {
  const explanationOk = isBanglaText(result.explanation || '');
  const findings = Array.isArray(result.key_findings) ? result.key_findings : [];
  const findingsOk = findings.every((item) => isBanglaText(item));

  if (explanationOk && findingsOk) return result;

  return {
    ...result,
    verdict: 'Uncertain',
    verdict_code: 'uncertain',
    explanation: languageText.missingBangla,
    key_findings: [languageText.missingBanglaFinding]
  };
}

function buildJsonOnlyInstructions(language) {
  const languageLines = language === 'bn'
    ? [
        'Write the explanation and key_findings only in Bangla (বাংলা).',
        'Do not use English in explanation or key_findings except proper nouns or URLs.',
        'If you cannot respond in Bangla, return verdict "Uncertain" with Bangla explanation and key_findings.'
      ]
    : ['Write the explanation and key_findings in English.'];

  return [
    'To ensure accuracy, think through these steps silently before answering:',
    '1. Identify the entities and core claim.',
    '2. Evaluate the evidence from the search results.',
    '3. Check for manipulation or missing context.',
    ...languageLines,
    'Return only a JSON object with this schema:',
    '{',
    '  "verdict": "Likely True" | "Likely False" | "Uncertain" | "Satirical",',
    '  "confidence": 0-100,',
    '  "explanation": "3-5 lines citing specific evidence from your web search.",',
    '  "key_findings": ["finding 1", "finding 2"],',
    '  "sources": ["url1", "url2"]',
    '}',
    'Do not include code fences or any extra text.'
  ].join('\n');
}

async function verifyFactCheck(req, res, next) {
  const t0 = Date.now();
  try {
    let { type, content } = req.body;
    const language = normalizeLanguage(req.body.language || req.body.uiLanguage);
    const lowBandwidth = Boolean(req.body.lowBandwidth);
    const languageText = LANGUAGE_TEXT[language];

    // Handle social media links
    if (type === 'social-media' || (type === 'text' && isSocialMediaLink(content))) {
      const socialUrl = req.body.url || content;
      const extractedText = await extractFromSocialMedia(socialUrl);
      if (extractedText) {
        content = extractedText;
        type = 'text';
      } else {
        return res.status(400).json({
          verdict: 'Error',
          verdict_code: 'error',
          explanation: languageText.parseError
        });
      }
    }

    if (!content) {
      return res.status(400).json({
        verdict: 'Error',
        verdict_code: 'error',
        explanation: languageText.noContent
      });
    }

    // ── Step 0: Redis cache check ──────────────────────────────────────────
    // For images, cache by srcUrl (content field); for text, cache by the text itself.
    const cached = await getCached(type, content, { language, lowBandwidth });
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
        verdict_code: 'satirical',
        confidence: 90,
        explanation: `${languageText.satiricalExplanation} ${extracted.satirical_reason || ''}`.trim(),
        key_findings: [languageText.satiricalFinding],
        sources: []
      };
      await setCached(type, content, satiricalResult, { language, lowBandwidth });
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

    const jsonOnlyInstructions = buildJsonOnlyInstructions(language);

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
        jsonOnlyInstructions
      ];
      promptText = lines.join('\\n');
    } else if (imageBlock) {
      // Fallback if extraction failed
      promptParts.push(imageBlock);
      promptText = `Fact-check this image. Search the web to verify it. ${jsonOnlyInstructions}`;
    } else {
      promptText = `Fact-check the following claim:\\n\\n"${content}"\\n\\nSearch the web to verify this claim.\\n${factCheckSection}\\n\\n${jsonOnlyInstructions}`;
    }

    promptParts.push({ type: 'text', text: promptText });

    // ── Step 4: Web search + verdict ──────────────────────────────────────
    const { text: rawVerdict, urls } = await searchAndVerdict(promptParts, { language });
    console.log(`[Done] ${Date.now() - t0}ms`);

    // ── Parse result ───────────────────────────────────────────────────────
    let result;
    try {
      result = extractJson(rawVerdict);
    } catch {
      result = {
        verdict: 'Uncertain',
        confidence: 0,
        explanation: languageText.parseError,
        key_findings: [],
        sources: []
      };
    }

    result.verdict_code = result.verdict_code || normalizeVerdictCode(result.verdict);

    if (language === 'bn') {
      result = enforceBanglaOutput(result, languageText);
    }

    if (!result.sources?.length) result.sources = urls.slice(0, 3);

    // ── Step 5: Cache result in Redis ─────────────────────────────────────
    await setCached(type, content, result, { language, lowBandwidth });

    res.json(result);

  } catch (error) {
    next(error);
  }
}

module.exports = { verifyFactCheck };
