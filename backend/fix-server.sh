#!/bin/bash
# FINAL FIX SCRIPT - Run on your Linux server
# Usage: bash fix-server.sh
set -e

DIR="/www/wwwroot/ytb-downloader"
cd "$DIR"

echo "🔧 Stopping server..."
pkill -f "node server" 2>/dev/null || true
sleep 1

echo "📝 Writing routes/info.js..."
cat > routes/info.js << 'EOF'
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
    const args = [
      url,
      '--no-check-certificates',
      '--no-playlist',
      '--geo-bypass',
      '--js-runtimes', 'node',
      '--extractor-args', 'youtube:player_client=ios,android,web',
      '--dump-json',
    ];
    if (hasCookies) args.push('--cookies', cookiesPath);

    console.log('[info] Running:', ytdlpPath, args.join(' '));
    const stdout = execFileSync(ytdlpPath, args, { encoding: 'utf8', timeout: 30000 });
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
EOF

echo "📝 Writing routes/download.js..."
cat > routes/download.js << 'EOF'
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

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safeTitle + '.mp3"');
    res.setHeader('X-Video-Title', encodeURIComponent(info.title));
    res.setHeader('X-Video-Duration', info.duration || 0);

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
      '-i', 'pipe:0', '-vn',
      '-acodec', 'libmp3lame', '-ab', '192k', '-ar', '44100',
      '-f', 'mp3', 'pipe:1',
    ]);

    ytProcess.stdout.pipe(ffProcess.stdin);
    ffProcess.stdout.pipe(res);

    ytProcess.stderr.on('data', (d) => console.log('[yt-dlp]', d.toString()));
    ffProcess.stderr.on('data', (d) => console.log('[ffmpeg]', d.toString()));
    ytProcess.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: 'yt-dlp failed', detail: err.message });
    });
    ffProcess.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: 'ffmpeg failed', detail: err.message });
    });
    res.on('close', () => { ytProcess.kill(); ffProcess.kill(); });

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
EOF

echo "📝 Writing utils/ytdlp.js..."
mkdir -p utils
cat > utils/ytdlp.js << 'EOF'
const path = require('path');
const fs = require('fs');
const os = require('os');

function getPyPath() {
    const isWindows = os.platform() === 'win32';
    const binaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
    const localBinaryPath = path.join(__dirname, '..', binaryName);
    const ytdlpPath = fs.existsSync(localBinaryPath) ? localBinaryPath : 'yt-dlp';
    const cookiesPath = path.join(__dirname, '..', 'cookies.txt');
    const hasCookies = fs.existsSync(cookiesPath);
    return { ytdlpPath, cookiesPath, hasCookies };
}

module.exports = getPyPath;
EOF

echo ""
echo "🔍 Checking dependencies..."
echo -n "  yt-dlp: "; yt-dlp --version 2>/dev/null || echo "NOT FOUND"
echo -n "  ffmpeg: "; ffmpeg -version 2>/dev/null | head -1 || echo "NOT FOUND"
echo -n "  node:   "; node --version
echo -n "  cookies: "
if [ -f cookies.txt ]; then
    echo "FOUND ($(wc -c < cookies.txt) bytes)"
else
    echo "MISSING ❌"
fi

echo ""
echo "🚀 Starting server..."
node server.js
