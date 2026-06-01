const axios = require('axios');

async function extractFromSocialMedia(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const html = response.data;
    
    // Extract from Twitter/X
    if (url.includes('twitter.com') || url.includes('x.com')) {
      const tweetMatch = html.match(/"text":"([^"]+)"/);
      if (tweetMatch) return tweetMatch[1];
    }
    
    // Extract from Facebook
    if (url.includes('facebook.com')) {
      const fbMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
      if (fbMatch) return fbMatch[1];
    }
    
    // Extract from TikTok
    if (url.includes('tiktok.com')) {
      const tikMatch = html.match(/"desc":"([^"]+)"/);
      if (tikMatch) return tikMatch[1];
    }
    
    // Extract from Instagram
    if (url.includes('instagram.com')) {
      const igMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
      if (igMatch) return igMatch[1];
    }
    
    // Generic extraction - try to get og:description
    const ogDescMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
    if (ogDescMatch) return ogDescMatch[1];
    
    // Fallback - extract text from title
    const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
    if (titleMatch) return titleMatch[1];
    
    return null;
  } catch (error) {
    console.error('Failed to extract from social media:', error.message);
    return null;
  }
}

module.exports = { extractFromSocialMedia };
