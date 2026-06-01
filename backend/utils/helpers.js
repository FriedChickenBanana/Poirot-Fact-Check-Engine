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
  const raw = String(text || '');
  if (!raw.trim()) throw new Error('No JSON found in response');

  const tryParse = (candidate) => {
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  };

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  for (const match of raw.matchAll(fenceRegex)) {
    const parsed = tryParse(match[1]);
    if (parsed) return parsed;
  }

  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  let lastCandidate = null;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const candidate = raw.slice(start, i + 1);
        const parsed = tryParse(candidate);
        if (parsed) return parsed;
        lastCandidate = candidate;
        start = -1;
      }
    }
  }

  if (lastCandidate) {
    const parsed = tryParse(lastCandidate);
    if (parsed) return parsed;
  }

  throw new Error('No JSON found in response');
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
