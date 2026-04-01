const path = require('path');
const fs = require('fs');
const os = require('os');

function getPyPath() {
    const isWindows = os.platform() === 'win32';
    const binaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
    
    // Check various common paths
    const localBinaryPath = path.join(__dirname, '..', binaryName);
    const nodeModulesBinaryPath = path.join(__dirname, '..', 'node_modules', 'yt-dlp-wrap', 'bin', binaryName);

    // Prefer specific binary if it exists, otherwise use global command
    const ytdlpPath = fs.existsSync(localBinaryPath) ? localBinaryPath : 
                      fs.existsSync(nodeModulesBinaryPath) ? nodeModulesBinaryPath : 'yt-dlp';

    const cookiesPath = path.join(__dirname, '..', 'cookies.txt');
    const hasCookies = fs.existsSync(cookiesPath);

    return { 
        ytdlpPath, 
        cookiesPath, 
        hasCookies 
    };
}

module.exports = getPyPath;
