#!/bin/bash
# Fix script - Run this on your Linux server
# Usage: bash fix-server.sh

SERVER_DIR="/www/wwwroot/ytb-downloader"
cd "$SERVER_DIR" || exit 1

echo "🔧 Fixing server files..."

# Kill any running node processes
pkill -f node 2>/dev/null
sleep 1

# 1. Fix routes/info.js
cat > routes/info.js << 'INFOEOF'
const express = require('express');
const router = express.Router();
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const COOKIES_PATH = path.join(__dirname, '..', 'cookies.txt');

router.get('/', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    const hasCookies = fs.existsSync(COOKIES_PATH);
    const args = [
      `"${url}"`,
      '--no-check-certificates',
      '--no-playlist',
      '--geo-bypass',
      '--dump-json',
    ];

    if (hasCookies) args.push('--cookies', `"${COOKIES_PATH}"`);

    const command = `yt-dlp ${args.join(' ')}`;
    console.log('[info] Running:', command);

    const stdout = execSync(command, { encoding: 'utf8', timeout: 30000 });
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
    console.error('[info error]', err.message);
    res.status(500).json({
      error: 'Failed to fetch video info.',
      detail: err.stderr || err.message,
    });
  }
});

module.exports = router;
INFOEOF

echo "✅ routes/info.js fixed"

# 2. Fix routes/download.js
cat > routes/download.js << 'DLEOF'
const express = require('express');
const router = express.Router();
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const COOKIES_PATH = path.join(__dirname, '..', 'cookies.txt');

router.get('/', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    const hasCookies = fs.existsSync(COOKIES_PATH);

    // 1. Fetch info
    const infoArgs = [
      `"${url}"`,
      '--no-check-certificates',
      '--no-playlist',
      '--geo-bypass',
      '--dump-json',
    ];
    if (hasCookies) infoArgs.push('--cookies', `"${COOKIES_PATH}"`);

    const infoCmd = `yt-dlp ${infoArgs.join(' ')}`;
    console.log('[download info] Running:', infoCmd);
    const infoStdout = execSync(infoCmd, { encoding: 'utf8', timeout: 30000 });
    const info = JSON.parse(infoStdout);
    const safeTitle = info.title.replace(/[^\w\s-]/gi, '').trim() || 'audio';

    // 2. Set response headers
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
    res.setHeader('X-Video-Title', encodeURIComponent(info.title));
    res.setHeader('X-Video-Duration', info.duration || 0);

    // 3. Stream: yt-dlp -> ffmpeg -> response
    const dlArgs = [
      url,
      '-f', 'bestaudio',
      '-o', '-',
      '--no-playlist',
      '--no-check-certificates',
      '--geo-bypass',
    ];
    if (hasCookies) dlArgs.push('--cookies', COOKIES_PATH);

    console.log('[download stream] yt-dlp', dlArgs.join(' '));
    const ytProcess = spawn('yt-dlp', dlArgs);
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
      console.error('[yt-dlp spawn error]', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'yt-dlp failed' });
    });

    ffProcess.on('error', (err) => {
      console.error('[ffmpeg spawn error]', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'ffmpeg failed' });
    });

    res.on('close', () => {
      ytProcess.kill();
      ffProcess.kill();
    });

  } catch (err) {
    console.error('[download error]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Download failed.', detail: err.stderr || err.message });
    }
  }
});

module.exports = router;
DLEOF

echo "✅ routes/download.js fixed"

# 3. Update yt-dlp to latest version
echo "🔄 Updating yt-dlp..."
pip3 install -U yt-dlp 2>/dev/null || pip install -U yt-dlp 2>/dev/null || echo "⚠️  pip not found, trying direct download..."
yt-dlp -U 2>/dev/null

# 4. Check yt-dlp version
echo ""
echo "📦 yt-dlp version:"
yt-dlp --version

# 5. Check if cookies exist
if [ -f "$SERVER_DIR/cookies.txt" ]; then
    echo "🍪 cookies.txt found ($(wc -c < "$SERVER_DIR/cookies.txt") bytes)"
else
    echo "⚠️  cookies.txt NOT found!"
fi

# 6. Check if ffmpeg exists
if command -v ffmpeg &> /dev/null; then
    echo "🎬 ffmpeg found"
else
    echo "❌ ffmpeg NOT found - installing..."
    apt-get install -y ffmpeg
fi

# 7. Quick test - just check if yt-dlp can reach YouTube
echo ""
echo "🧪 Testing yt-dlp connectivity..."
if [ -f "$SERVER_DIR/cookies.txt" ]; then
    yt-dlp "https://www.youtube.com/watch?v=iOK22WDIN4Y" --no-check-certificates --no-playlist --geo-bypass --cookies "$SERVER_DIR/cookies.txt" --dump-json 2>&1 | head -5
else
    yt-dlp "https://www.youtube.com/watch?v=iOK22WDIN4Y" --no-check-certificates --no-playlist --geo-bypass --dump-json 2>&1 | head -5
fi

echo ""
echo "🚀 Starting server..."
node server.js &
sleep 2
echo ""
echo "✅ Done! Server should be running on port 3001"
echo "🔗 Test: curl http://localhost:3001/health"
