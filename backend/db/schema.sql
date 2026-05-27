-- Run this in your Neon DB SQL Editor

CREATE TABLE IF NOT EXISTS user_feedback (
    id SERIAL PRIMARY KEY,
    claim_type VARCHAR(10) NOT NULL CHECK (claim_type IN ('text', 'image')),
    claim_content TEXT NOT NULL, -- Text string or Cloudinary URL
    agent_verdict VARCHAR(50) NOT NULL,
    agent_explanation TEXT,
    feedback_is_positive BOOLEAN NOT NULL, -- true for thumbs up, false for thumbs down
    user_explanation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
