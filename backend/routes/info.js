const express = require('express');
const router = express.Router();
const { validateYouTubeUrl } = require('../middleware/validateUrl');
const { ytDlp, cookiesPath, hasCookies } = require('../utils/ytdlp');

router.get('/', validateYouTubeUrl, async (req, res) => {
  const { url } = req.query;

  try {
    const args = [
      url,
      '--no-check-certificates',
      '--no-playlist',
      '--geo-bypass',
      '--no-cookies-from-browser',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--extractor-args', 'youtube:player-client=android',
      '--dump-json',
    ];

    if (hasCookies) {
      args.push('--cookies', cookiesPath);
    }

    const info = await ytDlp.getVideoInfo(args);

    // Guard: reject if video too long
    const maxDuration = parseInt(process.env.MAX_DURATION_SECONDS || 1800);
    if (info.duration > maxDuration) {
      return res.status(400).json({
        error: `Video too long. Max allowed: ${maxDuration / 60} minutes.`
      });
    }

    res.json({
      title: info.title,
      author: info.uploader,
      duration: info.duration,           // seconds
      thumbnail: info.thumbnail,         // URL
      filesize: info.filesize_approx,    // bytes (approx)
      webpage_url: info.webpage_url,
    });

  } catch (err) {
    console.error('[/info error]', err.message);
    res.status(500).json({ error: 'Failed to fetch video info. YouTube might be blocking the server IP.', detail: err.message });
  }
});

module.exports = router;
