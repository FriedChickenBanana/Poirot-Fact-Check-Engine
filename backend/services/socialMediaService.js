// ══════════════════════════════════════════════════════════════════════════
// SOCIAL MEDIA SERVICE — best-effort claim-text extraction from a pasted URL
//
// Strategy (no LLM, no auth, bounded to ≤2 HTTP requests → near-zero cost/time):
//   1. STRUCTURED endpoints first — auth-free and far more reliable than
//      scraping: YouTube/TikTok oEmbed, Reddit ".json", Twitter/X publish
//      oEmbed. These return the actual post text as JSON.
//   2. FALLBACK — fetch the page and read platform markers or Open Graph meta.
//
// Inherently brittle (platforms block scraping / require auth / render client-
// side), so it returns null on ANY failure and never throws — the caller then
// degrades gracefully. This only changes WHICH text feeds the unchanged verdict
// pipeline, so extraction quality never affects verdict accuracy.
//
// Uses native fetch (Node ≥18) — no axios dependency.
// ══════════════════════════════════════════════════════════════════════════

const FETCH_TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const OG_DESC = /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i;
const OG_TITLE = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i;

async function fetchText(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, ...headers },
      signal: controller.signal,
      redirect: 'follow',
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null; // timeout / network / blocked → caller falls back
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  const txt = await fetchText(url, { Accept: 'application/json' });
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return null; }
}

// Decode JSON \uXXXX escapes + common HTML entities, strip tags, collapse space.
function clean(text) {
  if (!text) return null;
  const out = text
    .replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out || null;
}

function firstMatch(html, regex) {
  const m = html && html.match(regex);
  return m ? m[1] : null;
}

// Step 1: structured, auth-free endpoints (most reliable).
async function tryStructured(url) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    const j = await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    return j?.title || null;
  }
  if (url.includes('tiktok.com')) {
    const j = await fetchJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    return j?.title || null;
  }
  if (url.includes('reddit.com')) {
    const j = await fetchJson(url.replace(/\/+$/, '') + '.json');
    const d = (Array.isArray(j) ? j[0]?.data?.children?.[0]?.data : j?.data?.children?.[0]?.data);
    return d ? ([d.title, d.selftext].filter(Boolean).join('. ') || null) : null;
  }
  if (url.includes('twitter.com') || url.includes('x.com')) {
    const j = await fetchJson(`https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&dnt=true&omit_script=true`);
    return j?.html || null; // HTML blockquote — clean() strips tags to the text
  }
  return null; // facebook / instagram / linkedin / threads → no auth-free API
}

// Step 2: fallback — scrape platform markers or Open Graph meta from the page.
async function tryScrape(url) {
  const html = await fetchText(url);
  if (!html) return null;
  let raw = null;
  if (url.includes('twitter.com') || url.includes('x.com')) raw = firstMatch(html, /"text":"([^"]+)"/);
  else if (url.includes('tiktok.com')) raw = firstMatch(html, /"desc":"([^"]+)"/);
  return raw || firstMatch(html, OG_DESC) || firstMatch(html, OG_TITLE);
}

async function extractFromSocialMedia(url) {
  if (!url) return null;
  try {
    const structured = clean(await tryStructured(url));
    if (structured) return structured;
    return clean(await tryScrape(url));
  } catch (err) {
    console.warn('[Social] Extraction failed:', err.message);
    return null;
  }
}

module.exports = { extractFromSocialMedia };
