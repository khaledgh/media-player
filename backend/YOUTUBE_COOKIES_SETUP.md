# YouTube Cookies Setup Guide
YouTube now requires authentication to download videos to prevent bot abuse. You need to export your YouTube cookies and provide them to yt-dlp.

## Quick Setup

### Option 1: Using Browser Extension (Recommended)

1. Install a cookie export extension:
   - Chrome/Edge: [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
   - Firefox: [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)

2. Go to [YouTube](https://www.youtube.com) and make sure you're logged in

3. Click the extension icon and export cookies for `youtube.com`

4. Save the exported file as `cookies.txt` in the `backend` directory of this project

### Option 2: Using yt-dlp Command (Linux/Mac)

If you have a browser installed on your Linux server:

```bash
# For Firefox
yt-dlp --cookies-from-browser firefox --cookies cookies.txt "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# For Chrome/Chromium
yt-dlp --cookies-from-browser chrome --cookies cookies.txt "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

This will create a `cookies.txt` file that you can use.

### Option 3: Manual Cookie Export

1. Open YouTube in your browser while logged in
2. Open Developer Tools (F12)
3. Go to the Application/Storage tab
4. Find Cookies → https://www.youtube.com
5. Export all cookies to a Netscape format cookies.txt file

## File Location

Place the `cookies.txt` file in:
```
backend/cookies.txt
```

## Security Notes

- **NEVER** commit `cookies.txt` to git (it's already in .gitignore)
- Cookies contain your authentication tokens - keep them private
- Cookies expire after some time - you may need to refresh them periodically
- If you see authentication errors, try exporting fresh cookies

## Troubleshooting

### "Sign in to confirm you're not a bot"
- Your cookies are missing or expired
- Export fresh cookies from a logged-in YouTube session

### "Could not find chrome cookies database"
- The server doesn't have Chrome installed
- Use Option 1 (browser extension) to export cookies manually

### Still not working?
- Make sure you're logged into YouTube when exporting cookies
- Try using a different browser
- Check that cookies.txt is in the correct location
- Verify the cookies.txt file is in Netscape format