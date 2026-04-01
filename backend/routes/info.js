const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const getPyPath = require('../utils/ytdlp');

router.get('/', async (req, res) => {
  const { url } = req.query;

  try {
    const { ytdlpPath, cookiesPath, hasCookies } = getPyPath();

    // Simplify arguments to avoid format errors
    const args = [
      `"${url}"`,
      '--no-check-certificates',
      '--no-playlist',
      '--geo-bypass',
      '--js-runtimes', 'node',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--dump-json',
      '-f', 'best'
    ];

    if (hasCookies) {
      args.push('--cookies', `"${cookiesPath}"`);
    }

    const command = `${ytdlpPath} ${args.join(' ')}`;
    console.log('Running info command:', command);

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('[yt-dlp info error]', stderr);
        return res.status(500).json({ 
          error: 'Failed to fetch video info.', 
          detail: stderr || error.message 
        });
      }

      try {
        const info = JSON.parse(stdout);
        res.json({
          id: info.id,
          title: info.title,
          thumbnail: info.thumbnail,
          duration: info.duration,
          view_count: info.view_count,
          uploader: info.uploader
        });
      } catch (parseError) {
        res.status(500).json({ error: 'Failed to parse video info.' });
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

module.exports = router;
