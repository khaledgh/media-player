const YTDlpWrap = require('yt-dlp-wrap').default;
const path = require('path');
const fs = require('fs');
const os = require('os');

const isWindows = os.platform() === 'win32';
const binaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const localBinaryPath = path.join(__dirname, '..', binaryName);
const nodeModulesBinaryPath = path.join(__dirname, '..', 'node_modules', 'yt-dlp-wrap', 'bin', binaryName);

// Use local binary if it exists, otherwise use node_modules binary, otherwise assume it's in the PATH
const finalBinaryPath = fs.existsSync(localBinaryPath) ? localBinaryPath : 
                       fs.existsSync(nodeModulesBinaryPath) ? nodeModulesBinaryPath : 'yt-dlp';

const ytDlp = new YTDlpWrap(finalBinaryPath);

// Path to cookies file
const cookiesPath = path.join(__dirname, '..', 'cookies.txt');
const hasCookies = fs.existsSync(cookiesPath);

// Create a yt-dlp config file to prevent browser cookie usage
const configPath = path.join(__dirname, '..', 'yt-dlp.conf');
const configContent = `# yt-dlp configuration
# Do not use browser cookies
--no-cookies-from-browser
`;

try {
  fs.writeFileSync(configPath, configContent, 'utf8');
} catch (err) {
  console.warn('Could not write yt-dlp config file:', err.message);
}

module.exports = { ytDlp, cookiesPath, hasCookies };
