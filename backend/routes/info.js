const express = require('express');
const router = express.Router();
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const getPyPath = require('../utils/ytdlp');

router.get('/', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    const { ytdlpPath, cookiesPath, hasCookies } = getPyPath();

    // Using execFileSync — NO shell involved, no quoting needed
    const args = [
      url,
      '--no-check-certificates',
      '--no-playlist',
      '--geo-bypass',
      '--js-runtimes', 'node',
      '--dump-json',
    ];

    if (hasCookies) {
      args.push('--cookies', cookiesPath);
    }

    console.log('[info] Running:', ytdlpPath, args.join(' '));

    const stdout = execFileSync(ytdlpPath, args, {
      encoding: 'utf8',
      timeout: 30000,
    });

    const info = JSON.parse(stdout);
    res.json({
      id: info.id,
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      view_count: info.view_count,
      uploader: info.uploader,
    });
  } catch (err) {
    console.error('[info error]', err.stderr || err.message);
    res.status(500).json({
      error: 'Failed to fetch video info.',
      detail: (err.stderr || err.message || '').substring(0, 500),
    });
  }
});

module.exports = router;
