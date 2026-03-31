const express = require('express');
const router = express.Router();
const { validateYouTubeUrl } = require('../middleware/validateUrl');
const { ytDlp, cookiesPath, hasCookies } = require('../utils/ytdlp');

// Player clients to try in order of preference
const PLAYER_CLIENTS = ['mweb', 'android', 'ios', 'tv_embedded'];

async function tryGetVideoInfo(ytDlp, url, playerClients, cookiesPath, hasCookies) {
  let lastError = null;
  
  for (const client of playerClients) {
    try {
      const args = [
        url,
        '--no-check-certificates',
        '--no-playlist',
        '--geo-bypass',
        '--no-cookies-from-browser',
        '--user-agent', 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        '--extractor-args', `youtube:player-client=${client}`,
        '--dump-json',
      ];

      if (hasCookies) {
        args.push('--cookies', cookiesPath);
      }

      const info = await ytDlp.getVideoInfo(args);
      return info;
    } catch (err) {
      console.log(`[info] Player client '${client}' failed:`, err.message.split('\n')[0]);
      lastError = err;
    }
  }
  
  throw lastError;
}

router.get('/', validateYouTubeUrl, async (req, res) => {
  const { url } = req.query;

  try {
    const info = await tryGetVideoInfo(ytDlp, url, PLAYER_CLIENTS, cookiesPath, hasCookies);

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
    
    let errorMessage = 'Failed to fetch video info.';
    let errorDetail = err.message;
    
    if (err.message.includes('Sign in to confirm') || err.message.includes('not a bot')) {
      errorMessage = 'YouTube requires authentication. Please set up cookies.';
      errorDetail = 'YouTube is detecting bot behavior. You need to export your YouTube cookies and place them in backend/cookies.txt. See backend/YOUTUBE_COOKIES_SETUP.md for instructions.';
    } else if (err.message.includes('Video unavailable')) {
      errorMessage = 'Video is unavailable or private.';
    } else if (!hasCookies) {
      errorMessage = 'YouTube may require authentication.';
      errorDetail = err.message + '\n\nTip: If you see bot detection errors, set up cookies. See backend/YOUTUBE_COOKIES_SETUP.md';
    }
    
    res.status(500).json({ error: errorMessage, detail: errorDetail });
  }
});

module.exports = router;
