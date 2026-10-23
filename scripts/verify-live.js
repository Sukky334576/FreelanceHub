'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PUBLIC_FILES } = require('./build-site');

const SITE_URL = 'https://natthawit-studio.pages.dev/';
const output = path.resolve(__dirname, '../dist');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function verifyLive() {
  // Read the actual upload package, not potentially edited source files.
  const expected = new Map(PUBLIC_FILES.map(name => [name, hash(fs.readFileSync(path.join(output, name)))]));
  for (let attempt = 1; attempt <= 5; attempt++) {
    const failures = (await Promise.all(PUBLIC_FILES.map(async name => {
      try {
        const url = new URL(name === 'index.html' ? './' : name, SITE_URL);
        url.searchParams.set('verify', `${Date.now()}-${attempt}`);
        const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!response.ok) return `${name}: HTTP ${response.status}`;
        const actual = hash(Buffer.from(await response.arrayBuffer()));
        return actual === expected.get(name) ? null : `${name}: live content differs from dist`;
      } catch (error) {
        return `${name}: ${error.message}`;
      }
    }))).filter(Boolean);
    if (failures.length === 0) {
      console.log(`Verified all ${PUBLIC_FILES.length} public files at ${SITE_URL} against the upload package.`);
      return;
    }
    console.log(`Live verification ${attempt}/5: ${failures.join('; ')}`);
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error('Upload may have completed, but the production URL has not been verified. Check the Cloudflare deployment before reporting success or uploading again.');
}

verifyLive().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
