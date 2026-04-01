const express = require('express');
const router = express.Router();
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const getPyPath = require('../utils/ytdlp');

router.all('/', async (req, res) => {
  const url = req.query.url || (req.body && req.body.url);
  if (!url) return res.status(400).json({ error: 'Missing YouTube URL' });

  const { ytdlpPath, cookiesPath, hasCookies } = getPyPath();

  try {
    // 1. Fetch video info using execFileSync (no shell, no quoting issues)
    const infoArgs = [
      url,
      '--no-check-certificates',
      '--no-playlist',
      '--geo-bypass',
      '--js-runtimes', 'node',
      '--extractor-args', 'youtube:player_client=ios,android,web',
      '--dump-json',
    ];
    if (hasCookies) infoArgs.push('--cookies', cookiesPath);

    console.log('[download] Fetching info:', ytdlpPath, infoArgs.join(' '));

    const infoStdout = execFileSync(ytdlpPath, infoArgs, {
      encoding: 'utf8',
      timeout: 30000,
    });
    const info = JSON.parse(infoStdout);
    const safeTitle = info.title.replace(/[^\w\s-]/gi, '').trim() || 'audio';

    // 2. Set response headers
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
    res.setHeader('X-Video-Title', encodeURIComponent(info.title));
    res.setHeader('X-Video-Duration', info.duration || 0);

    // 3. Stream: yt-dlp | ffmpeg -> response (spawn = no shell)
    const dlArgs = [
      url,
      '-f', 'bestaudio',
      '-o', '-',
      '--no-playlist',
      '--no-check-certificates',
      '--geo-bypass',
      '--js-runtimes', 'node',
      '--extractor-args', 'youtube:player_client=ios,android,web',
    ];
    if (hasCookies) dlArgs.push('--cookies', cookiesPath);

    console.log('[download] Streaming:', ytdlpPath, dlArgs.join(' '));

    const ytProcess = spawn(ytdlpPath, dlArgs);
    const ffProcess = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-vn',
      '-acodec', 'libmp3lame',
      '-ab', '192k',
      '-ar', '44100',
      '-f', 'mp3',
      'pipe:1',
    ]);

    ytProcess.stdout.pipe(ffProcess.stdin);
    ffProcess.stdout.pipe(res);

    ytProcess.stderr.on('data', (d) => console.log('[yt-dlp]', d.toString()));
    ffProcess.stderr.on('data', (d) => console.log('[ffmpeg]', d.toString()));

    ytProcess.on('error', (err) => {
      console.error('[yt-dlp error]', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'yt-dlp failed', detail: err.message });
    });

    ffProcess.on('error', (err) => {
      console.error('[ffmpeg error]', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'ffmpeg failed', detail: err.message });
    });

    res.on('close', () => {
      ytProcess.kill();
      ffProcess.kill();
    });

  } catch (err) {
    console.error('[download error]', err.stderr || err.message);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Download failed.',
        detail: (err.stderr || err.message || '').substring(0, 500),
      });
    }
  }
});

module.exports = router;
