require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const infoRoute = require('./routes/info');
const downloadRoute = require('./routes/download');
const { globalRateLimit } = require('./middleware/rateLimit');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (required for express-rate-limit if behind Nginx/Cloudflare)
app.set('trust proxy', 1);

// Ensure tmp dir exists
const TMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// Middleware
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled so test UI works
app.use(morgan('dev'));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST'],
}));
app.use(express.json());
app.use(globalRateLimit);

// Serve test UI
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/info', infoRoute);
app.use('/download', downloadRoute);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// Temp file cleanup cron-like mechanism
const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes
setInterval(() => {
  try {
    const files = fs.readdirSync(TMP_DIR);
    const now = Date.now();
    files.forEach(file => {
      const filePath = path.join(TMP_DIR, file);
      const stats = fs.statSync(filePath);
      // Delete files older than 10 minutes
      if (now - stats.mtimeMs > CLEANUP_INTERVAL) {
        fs.unlinkSync(filePath);
      }
    });
  } catch (err) {
    console.error('Interval cleanup error:', err.message);
  }
}, CLEANUP_INTERVAL);

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`🎵 Test UI available at http://localhost:${PORT}`);
});
