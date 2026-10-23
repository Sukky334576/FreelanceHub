'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSite, PUBLIC_FILES } = require('../scripts/build-site');

const repoRoot = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'freelancehub-build-'));

function write(relativePath, contents) {
  const destination = path.join(fixture, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

function listFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? listFiles(path.join(directory, entry.name), `${name}/`) : [name];
  }).sort();
}

try {
  for (const name of PUBLIC_FILES) write(name, fs.readFileSync(path.join(repoRoot, name)));
  for (const name of ['.env', '.git/config', 'supabase_schema_upgrade.sql', 'tests/private.js', 'private-slip.jpg', 'package.json', 'CNAME', 'CODEX_COMMUNICATION.md']) {
    write(name, 'must never be public');
  }
  write('dist/old-secret.sql', 'stale deployed file');
  const result = buildSite(fixture);
  assert.deepEqual(listFiles(result.outputDir), [...PUBLIC_FILES].sort());
  for (const name of PUBLIC_FILES) {
    assert.deepEqual(fs.readFileSync(path.join(result.outputDir, name)), fs.readFileSync(path.join(repoRoot, name)));
  }
  console.log('PASS: builds real runtime assets exactly, excludes private files and removes stale output');

  const index = fs.readFileSync(path.join(fixture, 'index.html'), 'utf8');
  write('index.html', `${index}\n<script src="js/new-runtime.js"></script>`);
  assert.throws(() => buildSite(fixture), /Unlisted local asset/);
  write('index.html', index);
  console.log('PASS: refuses an incomplete package when HTML gains an unlisted dependency');

  const manifest = fs.readFileSync(path.join(fixture, 'manifest.json'), 'utf8');
  const invalidManifest = JSON.parse(manifest);
  invalidManifest.icons.push({ src: 'private-slip.jpg' });
  write('manifest.json', JSON.stringify(invalidManifest));
  assert.throws(() => buildSite(fixture), /Unlisted local asset/);
  write('manifest.json', manifest);
  console.log('PASS: validates PWA icon dependencies against the same public allowlist');

  fs.renameSync(path.join(fixture, 'js'), path.join(fixture, 'private-js'));
  fs.symlinkSync('private-js', path.join(fixture, 'js'), 'dir');
  assert.throws(() => buildSite(fixture), /symbolic link/);
  fs.unlinkSync(path.join(fixture, 'js'));
  fs.renameSync(path.join(fixture, 'private-js'), path.join(fixture, 'js'));
  console.log('PASS: refuses source directory symlinks');

  fs.rmSync(path.join(fixture, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(fixture, 'outside'));
  write('outside/keep.txt', 'keep');
  fs.symlinkSync('outside', path.join(fixture, 'dist'), 'dir');
  assert.throws(() => buildSite(fixture), /Refusing to replace dist/);
  assert.equal(fs.readFileSync(path.join(fixture, 'outside/keep.txt'), 'utf8'), 'keep');
  console.log('PASS: refuses output symlinks without deleting the target');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
