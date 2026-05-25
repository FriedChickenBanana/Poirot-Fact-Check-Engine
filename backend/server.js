require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Anthropic } = require('@anthropic-ai/sdk');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.get('/', (req, res) => res.send('Misinfo Detector Backend is running!'));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-5';

// ─── Parse base64 string into a Claude-compatible image block ──────────────
function buildImageBlock(base64) {
  if (!base64) return null;
  const m = base64.match(/^data:(image\/[\w+]+);base64,(.*)$/);
  if (!m) return null;
  let media_type = m[1];
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(media_type)) {
    media_type = 'image/jpeg';
  }
  return { type: 'image', source: { type: 'base64', media_type, data: m[2] } };
}

// ─── Extract JSON from Claude's response text ──────────────────────────────
function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON found in response');
  return JSON.parse(m[0]);
}

// ─── Collect URLs from web_search_tool_result blocks ──────────────────────
function collectUrls(content) {
  const urls = [];
  for (const b of content) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      b.content.forEach(c => { if (c?.url) urls.push(c.url); });
    }
  }
  return urls;
}

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
const VERDICT_SYSTEM = `You are a strict fact-checker for Bangladeshi and global news. Be precise and conservative.

IMPORTANT: Do exactly ONE web search, then immediately output your JSON verdict. Do NOT search again.

After searching, output ONLY valid JSON with no extra text:
{
  "verdict": "Likely True" | "Likely False" | "Uncertain",
  "confidence": 0-100,
  "explanation": "3-5 lines citing specific evidence from your web search. Be factual.",
  "key_findings": ["concrete finding 1", "concrete finding 2"],
  "sources": ["url1", "url2"]
}

Rules:
- "Likely True"  → Claim confirmed by reliable sources in your search results.
- "Likely False" → Claim is contradicted, image is reused/out-of-context, or fabricated.
- "Uncertain"    → Evidence is insufficient or conflicting. Never guess.`;

async function searchAndVerdict(userContent) {
  const messages = [{ role: 'user', content: userContent }];
  let collectedUrls = [];

  for (let i = 0; i < 2; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 900,
      system: VERDICT_SYSTEM,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
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

// ══════════════════════════════════════════════════════════════════════════
// MAIN ROUTE — POST /verify
// ══════════════════════════════════════════════════════════════════════════
app.post('/verify', async (req, res) => {
  const t0 = Date.now();
  try {
    const { type, content } = req.body;
    if (!content) return res.status(400).json({ verdict: 'Error', explanation: 'No content provided.' });

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
      return res.json({
        verdict: 'Satirical',
        confidence: 90,
        explanation: `This appears to be satirical or meme content. ${extracted.satirical_reason || ''}`.trim(),
        key_findings: ['Content identified as satire or humor, not a factual claim.'],
        sources: []
      });
    }

    // ── Step 3: Build user prompt for search+verdict ───────────────────────
    const promptParts = [];
    if (imageBlock) promptParts.push(imageBlock);

    let promptText;
    if (extracted) {
      // Image flow: pass extracted context + ask to search
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
        '',
        `Search the web using this query: "${extracted.search_query || extracted.key_claim}"`,
        'Then verify whether this claim is true or false and output your JSON verdict.'
      ];
      promptText = lines.join('\n');
    } else {
      // Text flow: straightforward fact-check
      promptText = `Fact-check the following claim:\n\n"${content}"\n\nSearch the web to verify this claim, then output your JSON verdict.`;
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
    res.json(result);

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ verdict: 'Error', explanation: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running → http://localhost:${PORT}`));
