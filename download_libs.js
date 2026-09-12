const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const lock = JSON.parse(fs.readFileSync(path.join(__dirname, 'vendor_libs.lock.json'), 'utf8')).libs;

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

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

  let anyMismatch = false;

  for (const [name, entry] of Object.entries(lock)) {
    const dest = path.join(__dirname, name);
    process.stdout.write(`Downloading ${name} (${entry.version})... `);
    try {
      await download(entry.url, dest);
      const actualHash = sha256(dest);
      if (actualHash !== entry.sha256) {
        anyMismatch = true;
        console.log(`[ DOWNLOADED, BUT HASH MISMATCH — expected ${entry.sha256}, got ${actualHash} ]`);
      } else {
        console.log(`[ SUCCESS, verified against vendor_libs.lock.json ]`);
      }
    } catch (err) {
      console.log(`[ FAILED: ${err.message} ]`);
    }
  }

  console.log("===================================================");
  if (anyMismatch) {
    console.log("One or more files didn't match vendor_libs.lock.json — the cdn build may have");
    console.log("changed, or something tampered with it in transit. don't ship these as-is; update");
    console.log("vendor_libs.lock.json deliberately once you've confirmed what changed and why.");
    process.exitCode = 1;
  } else {
    console.log("Done!");
  }
}

main();
