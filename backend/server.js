require('dotenv').config();
const express = require('express');
const cors = require('cors');
const verifyRoutes = require('./routes/verifyRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Basic health check route
app.get('/', (req, res) => res.send('Misinfo Detector Backend is running!'));

// API Routes
app.use('/verify', verifyRoutes);
app.use('/feedback', feedbackRoutes);

// Global Error Handler Middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.message);
  res.status(500).json({
    verdict: 'Error',
    explanation: err.message || 'An unexpected error occurred on the server.',
    confidence: 0,
    key_findings: [],
    sources: []
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running → http://localhost:${PORT}`));
