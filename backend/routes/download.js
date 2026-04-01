const express = require('express');
const router = express.Router();
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const getPyPath = require('../utils/ytdlp');

const TMP_DIR = path.join(__dirname, '..', 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

router.all('/', async (req, res) => {
  const url = req.query.url || (req.body && req.body.url);
  if (!url) return res.status(400).json({ error: 'Missing YouTube URL' });

  const { ytdlpPath, cookiesPath, hasCookies } = getPyPath();

  try {
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
    const infoStdout = execFileSync(ytdlpPath, infoArgs, { encoding: 'utf8', timeout: 30000 });
    const info = JSON.parse(infoStdout);
    const safeTitle = info.title.replace(/[^\w\s-]/gi, '').trim() || 'audio';

    const fileName = `dl_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const outputTemplate = path.join(TMP_DIR, `${fileName}.%(ext)s`);

    const dlArgs = [
      url,
      '-f', 'bestaudio/best', // fallback to best if bestaudio not found
      '-x', // extract audio
      '--audio-format', 'mp3',
      '--audio-quality', '192K', // high quality mp3
      '-o', outputTemplate,
      '--no-playlist',
      '--no-check-certificates',
      '--geo-bypass',
      '--js-runtimes', 'node',
      '--extractor-args', 'youtube:player_client=ios,android,web',
    ];
    if (hasCookies) dlArgs.push('--cookies', cookiesPath);

    console.log('[download] Starting background download:', ytdlpPath, dlArgs.join(' '));
    const ytProcess = spawn(ytdlpPath, dlArgs);
    let ytError = '';

    ytProcess.stderr.on('data', (d) => {
      ytError += d.toString();
      console.log('[yt-dlp]', d.toString());
    });

    ytProcess.stdout.on('data', (d) => {
      console.log('[yt-dlp msg]', d.toString());
    });

    ytProcess.on('error', (err) => {
      console.error('[yt-dlp spawn error]', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'yt-dlp process failed', detail: err.message });
    });

    ytProcess.on('close', (code) => {
      if (code !== 0) {
        if (!res.headersSent) {
          return res.status(500).json({ error: 'Download or conversion failed.', detail: ytError });
        }
        return;
      }

      const expectedFile = path.join(TMP_DIR, `${fileName}.mp3`);
      if (!fs.existsSync(expectedFile)) {
        if (!res.headersSent) {
          return res.status(500).json({ error: 'MP3 file was not generated.', detail: ytError });
        }
        return;
      }

      res.setHeader('X-Video-Title', encodeURIComponent(info.title));
      res.setHeader('X-Video-Duration', info.duration || 0);

      // Send the file and clean it up immediately after
      res.download(expectedFile, `${safeTitle}.mp3`, (err) => {
        if (err) console.error('Error sending file to client:', err);
        if (fs.existsSync(expectedFile)) {
          fs.unlinkSync(expectedFile);
        }
      });
    });

  } catch (err) {
    console.error('[download error]', err.stderr || err.message);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to initiate download.',
        detail: (err.stderr || err.message || '').substring(0, 500),
      });
    }
  }
});

module.exports = router;
