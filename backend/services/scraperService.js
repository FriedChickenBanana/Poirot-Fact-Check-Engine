// ══════════════════════════════════════════════════════════════════════════
// SCRAPER SERVICE — Real-world news ingestion via RSS feeds
//
// Satisfies the BuildFest "Scraping + parsing real-world data" requirement.
// Fetches and parses RSS XML from trusted Bangladeshi and global outlets,
// then stores articles into the knowledge base for RAG retrieval.
//
// Runs automatically on startup + every 6 hours (configured in server.js).
// Zero new npm dependencies — uses Node's built-in https module.
// ══════════════════════════════════════════════════════════════════════════

const https = require('https');
const http = require('http');
const { addToKnowledgeBase } = require('./ragService');

// RSS feeds: Bangladeshi (EN + BN) + global fact-check sources
// Note: all URLs must be RSS/XML feeds, not HTML homepages
const RSS_FEEDS = [
  // ── Global trusted sources ──────────────────────────────────────────────
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',         name: 'BBC News',        lang: 'en' },
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',    name: 'BBC Tech',        lang: 'en' },
  { url: 'https://www.snopes.com/feed/',                         name: 'Snopes',          lang: 'en' },
  { url: 'https://www.boomlive.in/feed',                         name: 'BOOM Live',       lang: 'en' },
  { url: 'https://www.altnews.in/feed/',                         name: 'Alt News',        lang: 'en' },

  // ── Bangladesh English sources ──────────────────────────────────────────
  { url: 'https://www.thedailystar.net/rss.xml',                 name: 'The Daily Star',  lang: 'en' },
  { url: 'https://bdnews24.com/stories.rss',                           name: 'bdnews24 EN',     lang: 'en' },
  { url: 'https://en.prothomalo.com/stories.rss',                      name: 'Prothom Alo EN',  lang: 'en' },

  // ── Bangladesh Bangla sources (বাংলা) ───────────────────────────────────
  // Bangla feeds are stored with lang:'bn' so the AI responds in Bangla
  { url: 'https://www.prothomalo.com/stories.rss',                     name: 'প্রথম আলো',       lang: 'bn' },
  { url: 'https://bangla.bdnews24.com/stories.rss',                    name: 'bdnews24 বাংলা',  lang: 'bn' },
  { url: 'https://dhakapost.com/rss/rss.xml',                  name: 'dhaka post বাংলা',      lang: 'bn' },
  { url: 'https://www.ittefaq.com.bd/feed/',                   name: 'দৈনিক ইত্তেফাক',  lang: 'bn' },
];

// ── Fetch a URL and return its body string ─────────────────────────────────
function fetchUrl(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const req = lib.get(url, {
      headers: { 'User-Agent': 'Poirot-Fact-Check-Engine/2.0 (+https://poirot-api.onrender.com)' },
      timeout: 8000,
    }, (res) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        return resolve(fetchUrl(res.headers.location, maxRedirects - 1));
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── Parse RSS/Atom XML — returns [{title, description, link, pubDate}] ─────
function parseRss(xml) {
  const items = [];

  // Match <item> or <entry> blocks
  const itemPattern = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let itemMatch;

  while ((itemMatch = itemPattern.exec(xml)) !== null) {
    const block = itemMatch[1];

    const title = stripTags(extract(block, 'title'));
    const description = stripTags(extract(block, 'description') || extract(block, 'summary') || extract(block, 'content'));
    const link = extract(block, 'link') || extractAttr(block, 'link', 'href');
    const pubDate = extract(block, 'pubDate') || extract(block, 'published') || extract(block, 'updated');

    if (title && title.length > 10) {
      items.push({ title: title.trim(), description: description.trim(), link: link.trim(), pubDate: pubDate.trim() });
    }
  }

  return items;
}

function extract(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>(?:<\\!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

function extractAttr(xml, tag, attr) {
  const match = xml.match(new RegExp(`<${tag}[^>]+${attr}=["']([^"']+)["']`, 'i'));
  return match ? match[1].trim() : '';
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

// ── Scrape one feed and ingest articles ────────────────────────────────────
async function scrapeFeed(feed) {
  try {
    const xml = await fetchUrl(feed.url);
    const items = parseRss(xml);

    let saved = 0;
    for (const item of items.slice(0, 15)) { // max 15 articles per feed
      const content = `${item.title}. ${item.description}`.substring(0, 800);
      if (content.length < 30) continue;

      await addToKnowledgeBase({
        content,
        contentType: 'article',
        sourceUrl: item.link,
        sourceName: feed.name,
        language: feed.lang,
        metadata: { scraped: true, pubDate: item.pubDate, feed: feed.name },
      });
      saved++;
    }

    console.log(`[Scraper] ${feed.name}: ${saved}/${items.length} articles ingested`);
    return saved;
  } catch (err) {
    console.warn(`[Scraper] ${feed.name} failed: ${err.message}`);
    return 0;
  }
}

// ── Main scrape runner — called on startup + every 6h ─────────────────────
async function scrapeAllFeeds() {
  console.log('[Scraper] Starting news ingestion...');
  const t0 = Date.now();
  let total = 0;

  for (const feed of RSS_FEEDS) {
    const count = await scrapeFeed(feed);
    total += count;
    // Small delay between feeds to be polite
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[Scraper] Done. ${total} articles ingested in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return total;
}

module.exports = { scrapeAllFeeds };
