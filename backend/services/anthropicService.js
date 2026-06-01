const { Anthropic } = require('@anthropic-ai/sdk');
const { extractJson, collectUrls } = require('../utils/helpers');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-5';

// ══════════════════════════════════════════════════════════════════════════
// STEP 2 — IMAGE EXTRACTION
// Analyzes the image visually before any web search.
// Also detects if image is satirical/meme to skip unnecessary searching.
// ══════════════════════════════════════════════════════════════════════════
async function extractImageInfo(imageBlock) {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: `You are a forensic image analyst specializing in South Asian (Bangladeshi) and global media.

Analyze the image and return ONLY valid JSON with no extra text:

{
  "is_satirical": true | false,
  "satirical_reason": "If satirical/meme, explain briefly why. Otherwise null.",
  "visible_text": "ALL text verbatim. Preserve Bengali Unicode (বাংলা) exactly — NEVER transliterate or romanize Bengali script.",
  "people": "Identifiable persons, politicians, or public figures. Include names if visible.",
  "location": "Country, city, flags, landmarks, any geographic clues.",
  "date_clues": "Any dates, timestamps, event-related clues.",
  "tone": "One of: alarming | propaganda | misleading | satire | meme | neutral | celebratory | violent",
  "source": "News logos, TV channel watermarks, website names, social media platform UI elements.",
  "manipulation": "AI generation signs, photo editing artifacts, splicing, unnatural lighting. Or 'None detected'.",
  "key_claim": "The single core factual claim this image is asserting or implying. Be specific.",
  "search_query": "The single best English-language Google search query to fact-check this image's key claim."
}`,
    messages: [{ role: 'user', content: [imageBlock, { type: 'text', text: 'Analyze this image for fact-checking.' }] }]
  });

  const raw = res.content.find(b => b.type === 'text')?.text || '';
  return extractJson(raw);
}

// ══════════════════════════════════════════════════════════════════════════
// STEP 3+4 — WEB SEARCH + VERDICT (2-iteration agentic loop)
//
// Iteration 1: Claude sees context → calls web_search tool ONCE
// Iteration 2: Claude reads results → outputs final JSON verdict
// ══════════════════════════════════════════════════════════════════════════
function buildVerdictSystem(language) {
  const languageLine = language === 'bn'
    ? 'Write the explanation and key_findings only in Bangla (বাংলা). Do not use English except proper nouns or URLs.'
    : 'Write the explanation and key_findings in English.';

  return `You are a strict fact-checker for Bangladeshi and global news. Be precise and conservative.

${languageLine}
Use verdict values exactly as listed in English.

IMPORTANT: Do exactly ONE web search, then immediately output your JSON verdict. Do NOT search again.

After searching, output ONLY valid JSON with no extra text:
{
  "verdict": "Likely True" | "Likely False" | "Uncertain" | "Satirical",
  "confidence": 0-100,
  "explanation": "3-5 lines citing specific evidence from your web search. Be factual.",
  "key_findings": ["concrete finding 1", "concrete finding 2"],
  "sources": ["url1", "url2"]
}

Rules:
- "Likely True"  → Claim confirmed by reliable sources in your search results.
- "Likely False" → Claim is contradicted, image is reused/out-of-context, or fabricated.
- "Uncertain"    → Evidence is insufficient or conflicting. Never guess.
- "Satirical"    → Content is clearly satire or parody, not a factual claim.`;
}

async function searchAndVerdict(userContent, options = {}) {
  const language = options.language === 'bn' ? 'bn' : 'en';
  const messages = [{ role: 'user', content: userContent }];
  let collectedUrls = [];

  for (let i = 0; i < 2; i++) {
    const isLastIteration = i === 1;
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 900,
      system: buildVerdictSystem(language),
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      // On the final iteration force text output — prevents Claude from searching
      // again instead of writing its verdict, which would leave text empty.
      ...(isLastIteration && { tool_choice: { type: 'none' } }),
      messages
    });

    // Collect URLs from server-side search result blocks
    collectedUrls = collectedUrls.concat(collectUrls(response.content));

    // Claude finished → extract the JSON verdict text
    if (response.stop_reason === 'end_turn') {
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      return { text, urls: collectedUrls };
    }

    // Claude called web_search → pass results back and continue
    messages.push({ role: 'assistant', content: response.content });
    const toolUses = response.content.filter(b => b.type === 'tool_use');
    if (!toolUses.length) break;

    // Pass the web_search_tool_result blocks back as tool_result so Claude reads them
    const searchResults = response.content.filter(b => b.type === 'web_search_tool_result');
    messages.push({
      role: 'user',
      content: toolUses.map(tu => {
        const matched = searchResults.find(r => r.tool_use_id === tu.id);
        return { type: 'tool_result', tool_use_id: tu.id, content: matched?.content ?? '' };
      })
    });
  }

  return { text: '', urls: collectedUrls };
}


module.exports = {
  extractImageInfo,
  searchAndVerdict
};