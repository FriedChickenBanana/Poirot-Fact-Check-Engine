// ══════════════════════════════════════════════════════════════════════════
// SOCIAL MEDIA SERVICE — best-effort claim-text extraction from a pasted URL
//
// Fetches a public social/post page and pulls the visible claim text out of
// platform-specific markers or Open Graph (og:) meta tags. This is INHERENTLY
// BRITTLE: most platforms block server-side scraping, require auth, or render
// client-side. It must therefore be best-effort — it returns null on ANY
// failure and never throws, so the caller can fall back gracefully.
//
// Uses native fetch (Node ≥18) — no axios dependency, consistent with
// factCheckService.
// ══════════════════════════════════════════════════════════════════════════

const FETCH_TIMEOUT_MS = 10000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// Pull the first capture group of a regex from the HTML, or null.
function firstMatch(html, regex) {
  const m = html.match(regex);
  return m ? m[1] : null;
}

async function extractFromSocialMedia(url) {
  if (!url) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const html = await res.text();
    const ogDesc = /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i;
    const ogTitle = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i;

    // Platform-specific markers first, then Open Graph fallbacks.
    if (url.includes('twitter.com') || url.includes('x.com')) {
      return firstMatch(html, /"text":"([^"]+)"/) || firstMatch(html, ogDesc) || firstMatch(html, ogTitle);
    }
    if (url.includes('tiktok.com')) {
      return firstMatch(html, /"desc":"([^"]+)"/) || firstMatch(html, ogDesc) || firstMatch(html, ogTitle);
    }
    // facebook / instagram / youtube / linkedin / reddit / threads / generic
    return firstMatch(html, ogDesc) || firstMatch(html, ogTitle);
  } catch (err) {
    // Timeouts, network errors, blocked requests — all degrade to null.
    console.warn('[Social] Extraction failed:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { extractFromSocialMedia };
