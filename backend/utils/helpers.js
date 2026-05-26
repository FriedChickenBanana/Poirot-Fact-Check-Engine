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

module.exports = {
  buildImageBlock,
  extractJson,
  collectUrls
};
