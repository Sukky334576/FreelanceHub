'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Only browser runtime files belong on the public site. Never deploy the repo root.
const PUBLIC_FILES = Object.freeze([
  'index.html',
  'guide.html',
  'manifest.json',
  'css/app-ui.css',
  'favicon.png',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'icon-1024.png',
  'js/financial-core.js',
  'js/slip-parser.js',
  'js/theme.js',
]);

function checkedSource(rootDir, relativePath) {
  let current = rootDir;
  for (const part of relativePath.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to publish symbolic link: ${relativePath}`);
    }
  }
  if (!fs.statSync(current).isFile()) {
    throw new Error(`Public asset is not a regular file: ${relativePath}`);
  }
  return current;
}

function validateReference(reference, fromFile) {
  const value = reference.trim();
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return;
  const sourceUrl = new URL(fromFile, 'https://build.invalid/');
  const relativePath = decodeURIComponent(new URL(value, sourceUrl).pathname).replace(/^\//, '');
  const destination = relativePath.endsWith('/') ? `${relativePath}index.html` : relativePath;
  if (!PUBLIC_FILES.includes(destination)) {
    throw new Error(`Unlisted local asset in ${fromFile}: ${reference}. Add reviewed browser assets to PUBLIC_FILES.`);
  }
}

function validateDependencies(rootDir) {
  for (const name of PUBLIC_FILES.filter(file => /\.(?:html|js|css)$/.test(file))) {
    const source = fs.readFileSync(path.join(rootDir, name), 'utf8');
    // Includes literal script.src assignments and HTML embedded in JavaScript.
    for (const match of source.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/g)) {
      validateReference(match[2], name);
    }
    for (const match of source.matchAll(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/g)) {
      validateReference(match[2], name);
    }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
  if (!manifest.start_url || !Array.isArray(manifest.icons)) {
    throw new Error('manifest.json must define start_url and icons');
  }
  validateReference(manifest.start_url, 'manifest.json');
  for (const icon of manifest.icons) validateReference(icon.src, 'manifest.json');
}

function buildSite(rootDir = path.resolve(__dirname, '..')) {
  rootDir = fs.realpathSync(rootDir);
  const outputDir = path.join(rootDir, 'dist');
  // lstat also catches dangling symlinks; deleting or writing through these is unsafe.
  let outputStat;
  try { outputStat = fs.lstatSync(outputDir); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (outputStat && (outputStat.isSymbolicLink() || !outputStat.isDirectory())) {
    throw new Error('Refusing to replace dist: expected a normal directory');
  }
  const sources = PUBLIC_FILES.map(name => [name, checkedSource(rootDir, name)]);
  validateDependencies(rootDir);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir);
  for (const [name, source] of sources) {
    const destination = path.join(outputDir, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  return { outputDir, files: [...PUBLIC_FILES] };
}

if (require.main === module) {
  try {
    const result = buildSite();
    console.log(`Built ${result.files.length} public files in ${result.outputDir}`);
  } catch (error) {
    console.error(`Build failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { buildSite, PUBLIC_FILES };
