const express = require('express');
const router = express.Router();
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const getPyPath = require('../utils/ytdlp');

router.all('/', async (req, res) => {
  // Support both GET (?url=...) and POST ({url: ...})
  const url = req.query.url || req.body.url;
  
  if (!url) {
    return res.status(400).json({ error: 'Missing YouTube URL' });
  }

  const { ytdlpPath, cookiesPath, hasCookies } = getPyPath();

  try {
    // 1. Fetch info first to get Title & Duration
    console.log('Fetching info for download:', url);
    const infoArgs = [
      `"${url}"`,
      '--no-check-certificates',
      '--no-playlist',
      '--geo-bypass',
      '--js-runtimes', 'node',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--dump-json'
    ];
    if (hasCookies) infoArgs.push('--cookies', `"${cookiesPath}"`);

    const infoCmd = `${ytdlpPath} ${infoArgs.join(' ')}`;
    const infoStdout = execSync(infoCmd, { encoding: 'utf8' });
    const info = JSON.parse(infoStdout);

    const safeTitle = info.title.replace(/[^\w\s-]/gi, '').trim() || 'video';

    // 2. Stream audio using yt-dlp | FFmpeg
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
    res.setHeader('X-Video-Title', encodeURIComponent(info.title));
    res.setHeader('X-Video-Duration', info.duration);

    const args = [
      `"${url}"`,
      '-f', 'bestaudio',
      '-o', '-',
      '--no-playlist',
      '--no-check-certificates',
      '--geo-bypass',
      '--js-runtimes', 'node',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    if (hasCookies) args.push('--cookies', `"${cookiesPath}"`);

    const ytProcess = spawn(ytdlpPath, args);
    const ffmpegProcess = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-vn',
      '-acodec', 'libmp3lame',
      '-ab', '192k',
      '-ar', '44100',
      '-f', 'mp3',
      'pipe:1'
    ]);

    ytProcess.stdout.pipe(ffmpegProcess.stdin);
    ffmpegProcess.stdout.pipe(res);

    ytProcess.stderr.on('data', (data) => console.log('[yt-dlp stream]:', data.toString()));
    ffmpegProcess.stderr.on('data', (data) => console.log('[ffmpeg]:', data.toString()));

    res.on('close', () => {
      ytProcess.kill();
      ffmpegProcess.kill();
    });

  } catch (err) {
    console.error('[/download error]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Download failed.', detail: err.message });
    }
  }
});

module.exports = router;
