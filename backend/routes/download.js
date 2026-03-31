const express = require('express');
const router = express.Router();
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { validateYouTubeUrl } = require('../middleware/validateUrl');
const { ytDlp, cookiesPath, hasCookies } = require('../utils/ytdlp');

ffmpeg.setFfmpegPath(ffmpegPath);
const TMP_DIR = path.join(__dirname, '../tmp');

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
      return { info, client };
    } catch (err) {
      console.log(`[download] Player client '${client}' failed:`, err.message.split('\n')[0]);
      lastError = err;
    }
  }
  
  throw lastError;
}

router.all('/', validateYouTubeUrl, async (req, res) => {
  const url = req.query.url || req.body?.url;
  const quality = req.query.quality || req.body?.quality || '192';
  const tmpFile = path.join(TMP_DIR, `${uuidv4()}.mp3`);
  let cleanupDone = false;

  const cleanup = () => {
    if (!cleanupDone && fs.existsSync(tmpFile)) {
      try {
        fs.unlinkSync(tmpFile);
      } catch (err) {
        console.error('Cleanup error:', err.message);
      }
      cleanupDone = true;
    }
  };

  try {
    // Get title for filename using fallback strategy
    const { info, client } = await tryGetVideoInfo(ytDlp, url, PLAYER_CLIENTS, cookiesPath, hasCookies);
    const safeTitle = info.title.replace(/[^a-z0-9\s\-_]/gi, '').trim() || 'audio';

    // Set response headers
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
    res.setHeader('X-Video-Title', encodeURIComponent(info.title));
    res.setHeader('X-Video-Duration', info.duration);

    // Stream audio from yt-dlp → FFmpeg → response (use same client that worked for info)
    const args = [
      url,
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
      '-o', '-',
      '--no-playlist',
      '--no-check-certificates',
      '--geo-bypass',
      '--no-cookies-from-browser',
      '--user-agent', 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      '--extractor-args', `youtube:player-client=${client}`,
    ];

    if (hasCookies) {
      args.push('--cookies', cookiesPath);
    }

    const audioStream = ytDlp.execStream(args);

    const ffmpegProcess = ffmpeg(audioStream)
      .audioBitrate(quality)
      .format('mp3')
      .on('error', (err) => {
        console.error('[FFmpeg error]', err.message);
        cleanup();
        if (!res.headersSent) {
          res.status(500).json({ error: 'Conversion failed', detail: err.message });
        }
      });

    ffmpegProcess.pipe(res, { end: true });

    res.on('close', cleanup);
    res.on('finish', cleanup);

  } catch (err) {
    cleanup();
    console.error('[/download error]', err.message);
    if (!res.headersSent) {
      let errorMessage = 'Download failed.';
      let errorDetail = err.message;
      
      if (err.message.includes('Sign in to confirm') || err.message.includes('not a bot')) {
        errorMessage = 'YouTube requires authentication. Please set up cookies.';
        errorDetail = 'YouTube is detecting bot behavior. You need to export your YouTube cookies and place them in backend/cookies.txt. See backend/YOUTUBE_COOKIES_SETUP.md for instructions.';
      } else if (err.message.includes('Video unavailable')) {
        errorMessage = 'Video is unavailable or private.';
      } else if (!hasCookies) {
        errorMessage = 'Download failed. YouTube may require authentication.';
        errorDetail = err.message + '\n\nTip: If you see bot detection errors, set up cookies. See backend/YOUTUBE_COOKIES_SETUP.md';
      }
      
      res.status(500).json({ error: errorMessage, detail: errorDetail });
    }
  }
});

module.exports = router;
