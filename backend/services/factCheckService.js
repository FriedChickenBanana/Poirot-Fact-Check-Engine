const FACT_CHECK_API = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';

async function queryGoogleFactCheck(query) {
  const key = process.env.GOOGLE_FACT_CHECK_API_KEY;
  if (!key || !query) return [];

  try {
    const url = `${FACT_CHECK_API}?query=${encodeURIComponent(query)}&key=${key}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    if (!data.claims?.length) return [];

    return data.claims.slice(0, 3).map(claim => {
      const review = claim.claimReview?.[0];
      return {
        claim: claim.text || '',
        claimant: claim.claimant || 'Unknown',
        rating: review?.textualRating || 'No rating',
        publisher: review?.publisher?.name || 'Unknown',
        url: review?.url || ''
      };
    });
  } catch (err) {
    console.warn('[FactCheck] Google API error:', err.message);
    return [];
  }
}

module.exports = { queryGoogleFactCheck };
