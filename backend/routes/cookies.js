const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const cookiesPath = path.join(__dirname, '..', 'cookies.txt');

// POST /cookies - Save YouTube cookies from browser
router.post('/', (req, res) => {
  const { cookies } = req.body;

  if (!cookies || typeof cookies !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid cookies data' });
  }

  // Validate it looks like Netscape format
  if (!cookies.includes('# Netscape HTTP Cookie File') && !cookies.includes('.youtube.com')) {
    return res.status(400).json({ error: 'Invalid cookie format. Must be Netscape format.' });
  }

  // Ensure it has the header
  let cookieContent = cookies;
  if (!cookies.startsWith('# Netscape HTTP Cookie File')) {
    cookieContent = '# Netscape HTTP Cookie File\n' + cookies;
  }

  try {
    fs.writeFileSync(cookiesPath, cookieContent, 'utf8');
    console.log('✓ YouTube cookies saved successfully');
    res.json({ success: true, message: 'Cookies saved successfully' });
  } catch (err) {
    console.error('Failed to save cookies:', err.message);
    res.status(500).json({ error: 'Failed to save cookies', detail: err.message });
  }
});

// GET /cookies/status - Check if cookies exist
router.get('/status', (req, res) => {
  const exists = fs.existsSync(cookiesPath);
  let valid = false;
  
  if (exists) {
    try {
      const content = fs.readFileSync(cookiesPath, 'utf8');
      valid = content.includes('.youtube.com') && content.length > 100;
    } catch (err) {
      valid = false;
    }
  }

  res.json({ 
    exists, 
    valid,
    path: cookiesPath 
  });
});

// GET /cookies/bookmarklet - Get the bookmarklet code
router.get('/bookmarklet', (req, res) => {
  const backendUrl = `${req.protocol}://${req.get('host')}`;
  
  const bookmarkletCode = `javascript:(function(){if(!location.hostname.includes('youtube.com')){alert('Please run this on YouTube!');return;}var cookies='# Netscape HTTP Cookie File\\n'+document.cookie.split(';').map(function(c){var parts=c.trim().split('=');var name=parts[0];var value=parts.slice(1).join('=');return'.youtube.com\\tTRUE\\t/\\tTRUE\\t'+(Math.floor(Date.now()/1000)+31536000)+'\\t'+name+'\\t'+value;}).join('\\n');fetch('${backendUrl}/cookies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cookies:cookies})}).then(function(r){return r.json();}).then(function(d){if(d.success){alert('Cookies saved successfully!');}else{alert('Error: '+d.error);}}).catch(function(e){alert('Failed to save cookies: '+e.message);});})();`;

  res.type('text/plain').send(bookmarkletCode);
});

module.exports = router;
