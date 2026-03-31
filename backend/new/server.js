const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function puppeteerDownload(youtubeUrl) {
    // 1. Define where the MP3 should be saved on your server
    const downloadFolder = path.resolve(__dirname, 'downloads');
    
    // Create the folder if it doesn't exist
    if (!fs.existsSync(downloadFolder)){
        fs.mkdirSync(downloadFolder);
    }

    console.log("Launching browser...");
    // Change headless to false if you want to watch the bot work visually
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();

    // 2. CRITICAL STEP: Configure Chrome to automatically download files to our folder
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadFolder,
    });

    try {
        console.log("Navigating to the converter website...");
        // Replace this with the actual converter URL you want to scrape
        await page.goto('https://example-youtube-converter.com/', { waitUntil: 'networkidle2' });

        console.log("Pasting the YouTube URL...");
        // Replace '#input-url' with the actual ID or class of the site's input box
        await page.type('#input-url', youtubeUrl);

        console.log("Clicking the convert button...");
        // Replace '#convert-btn' with the actual button selector
        await page.click('#convert-btn');

        console.log("Waiting for the conversion to finish on their end...");
        // This waits for the download button to appear on the screen. 
        // Timeout is set to 60 seconds because conversion takes time.
        await page.waitForSelector('#download-btn', { visible: true, timeout: 60000 });

        console.log("Clicking Download! The file is streaming to your server...");
        await page.click('#download-btn');

        // 3. Wait for the download to complete
        // Puppeteer doesn't have a built-in "wait for download" function. 
        // We have to monitor the download folder to see when the .crdownload file becomes an .mp3
        await waitForDownload(downloadFolder);

        console.log("✅ Scenario complete! MP3 saved to:", downloadFolder);

    } catch (error) {
        console.error("Puppeteer encountered an error:", error.message);
    } finally {
        console.log("Closing browser to free up RAM.");
        await browser.close();
    }
}

// Helper function to watch the folder and wait until the Chrome temporary file (.crdownload) is gone
function waitForDownload(downloadPath) {
    return new Promise((resolve, reject) => {
        let watcher;
        let timeout = setTimeout(() => {
            if (watcher) watcher.close();
            reject(new Error("Download timed out."));
        }, 120000); // 2 minute maximum wait

        watcher = fs.watch(downloadPath, (eventType, filename) => {
            // If the file ends with .mp3 and there are no .crdownload files, it's done
            if (filename && filename.endsWith('.mp3')) {
                const files = fs.readdirSync(downloadPath);
                const isStillDownloading = files.some(file => file.endsWith('.crdownload'));
                
                if (!isStillDownloading) {
                    clearTimeout(timeout);
                    watcher.close();
                    resolve();
                }
            }
        });
    });
}

// Run the function
puppeteerDownload('https://www.youtube.com/watch?v=YUo0VU2lb-k');