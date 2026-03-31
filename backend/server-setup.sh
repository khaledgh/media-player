#!/bin/bash

# Update package list and install dependencies
sudo apt-get update
sudo apt-get install -y ffmpeg python3 curl nodejs

# Download yt-dlp binary to a global system path
echo "📥 Downloading yt-dlp latest for Linux..."
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp

# Make it executable and accessible globally
sudo chmod a+rx /usr/local/bin/yt-dlp

echo "✅ yt-dlp installed successfully globally!"
echo "Now restart your node server: npm stop && npm start"
