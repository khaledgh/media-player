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
    // Get title for filename
    const infoArgs = [
      url,
      '--no-check-certificates',
      '--no-playlist',
      '--geo-bypass',
      '--no-cookies-from-browser',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--extractor-args', 'youtube:player-client=android',
      '--dump-json',
    ];
    if (hasCookies) infoArgs.push('--cookies', cookiesPath);
    
    const info = await ytDlp.getVideoInfo(infoArgs);
    const safeTitle = info.title.replace(/[^a-z0-9\s\-_]/gi, '').trim() || 'audio';

    // Set response headers
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
    res.setHeader('X-Video-Title', encodeURIComponent(info.title));
    res.setHeader('X-Video-Duration', info.duration);

    // Stream audio from yt-dlp → FFmpeg → response
    const args = [
      url,
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
      '-o', '-',
      '--no-playlist',
      '--no-check-certificates',
      '--geo-bypass',
      '--no-cookies-from-browser',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--extractor-args', 'youtube:player-client=android',
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
      res.status(500).json({ 
        error: 'Download failed. Video may be unavailable or server is blocked.', 
        detail: err.message 
      });
    }
  }
});

module.exports = router;
