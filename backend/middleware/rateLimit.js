const rateLimit = require('express-rate-limit');

const globalRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: parseInt(process.env.RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before trying again.' },
});

module.exports = { globalRateLimit };
