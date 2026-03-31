const YOUTUBE_REGEX = /^(https?:\/\/)?(www\.|music\.)?(youtube\.com\/.*[?&]v=|youtu\.be\/|youtube\.com\/shorts\/)[\w\-]{11}/;

function validateYouTubeUrl(req, res, next) {
  const url = (req.query.url || req.body?.url)?.trim();

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  if (!YOUTUBE_REGEX.test(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  next();
}

module.exports = { validateYouTubeUrl };
