const https = require('https');
const fs = require('fs');
const path = require('path');

const libs = {
  "pdf.min.js": "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "pdf.worker.min.js": "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "mammoth.browser.min.js": "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      // Handle redirects if any
      if (response.statusCode === 301 || response.statusCode === 302) {
        download(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Status code ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

async function main() {
  console.log("===================================================");
  console.log("FeelCV Node Library Downloader");
  console.log("===================================================");
  for (const [name, url] of Object.entries(libs)) {
    process.stdout.write(`Downloading ${name}... `);
    try {
      await download(url, path.join(__dirname, name));
      console.log(`[ SUCCESS ]`);
    } catch (err) {
      console.log(`[ FAILED: ${err.message} ]`);
    }
  }
  console.log("===================================================");
  console.log("Done!");
}

main();
