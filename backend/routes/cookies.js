const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const COOKIES_PATH = path.join(__dirname, '..', 'cookies.txt');
const UPDATE_KEY = process.env.COOKIE_UPDATE_KEY || 'sonic_secret_key_123';

/**
 * GET /cookies/status
 * Check if cookies are set
 */
router.get('/status', (req, res) => {
  const exists = fs.existsSync(COOKIES_PATH);
  let status = { exists };

  if (exists) {
    const stats = fs.statSync(COOKIES_PATH);
    status.lastModified = stats.mtime;
    status.size = stats.size;
    status.message = "✅ Cookie file is active on server!";
  } else {
    status.message = "❌ Cookie file is missing.";
  }

  res.json(status);
});

/**
 * POST /cookies
 * Update the cookies.txt file on the server
 */
router.post('/', (req, res) => {
  const { key, content } = req.body;

  if (!key || key !== UPDATE_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid key.' });
  }

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Missing content. Please provide the cookie text.' });
  }

  try {
    fs.writeFileSync(COOKIES_PATH, content, 'utf8');
    console.log('✅ cookies.txt updated via API.');
    res.json({ success: true, message: 'cookies.txt updated successfully!' });
  } catch (err) {
    console.error('Error saving cookies:', err.message);
    res.status(500).json({ error: 'Failed to save cookies on server.' });
  }
});

module.exports = router;
