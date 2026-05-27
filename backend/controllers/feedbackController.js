const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function submitFeedback(req, res, next) {
  try {
    const { 
      type, 
      content, 
      base64, 
      verdict, 
      explanation, 
      feedbackIsPositive, 
      userExplanation 
    } = req.body;

    let claimContent = content;

    // If it's an image, we should store it in Cloudinary and save the URL
    if (type === 'image' && base64) {
      try {
        const uploadResponse = await cloudinary.uploader.upload(base64, {
          folder: 'misinfo-detector',
        });
        claimContent = uploadResponse.secure_url;
      } catch (uploadError) {
        console.error('Cloudinary upload error:', uploadError);
        // Fallback to storing just the URL if passed, or a string placeholder
        claimContent = 'Image upload failed: ' + content;
      }
    }

    const query = `
      INSERT INTO user_feedback 
        (claim_type, claim_content, agent_verdict, agent_explanation, feedback_is_positive, user_explanation) 
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id;
    `;
    
    const values = [
      type, 
      claimContent, 
      verdict || 'Unknown', 
      explanation || '', 
      Boolean(feedbackIsPositive), 
      userExplanation || ''
    ];

    const result = await pool.query(query, values);

    res.status(200).json({ success: true, feedbackId: result.rows[0].id });
  } catch (err) {
    console.error('Feedback insertion error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  submitFeedback
};