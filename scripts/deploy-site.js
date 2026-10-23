'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_NAME = 'natthawit-studio';
const PROJECT_DOMAIN = 'natthawit-studio.pages.dev';

function deploySite({ rootDir = path.resolve(__dirname, '..'), run = spawnSync, environment = process.env } = {}) {
  // Both Cloudflare commands share the same account environment and Pages cache.
  // CI disables Wrangler's interactive project-creation flow.
  const options = { cwd: rootDir, env: { ...environment, CI: '1' }, encoding: 'utf8', stdio: 'pipe' };
  function command(executable, args, label, overrides = {}) {
    const result = run(executable, args, { ...options, ...overrides });
    if (result.error || result.status !== 0) {
      throw new Error(`${label} failed. No further deployment commands were run.${result.error ? ` ${result.error.message}` : ''}`);
    }
    return result.stdout || '';
  }

  const branch = command('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], 'Reading Git branch').trim();
  if (branch !== 'main') {
    throw new Error('เผยแพร่ได้จาก branch main เท่านั้น / Deployment requires branch main.');
  }
  const changes = command('git', ['status', '--porcelain=v1', '--untracked-files=all'], 'Checking Git worktree');
  if (changes.trim()) {
    throw new Error('มีไฟล์ที่ยังไม่ได้ commit กรุณาบันทึกการเปลี่ยนแปลงก่อนเผยแพร่ / Commit source changes before deployment.');
  }

  const wrangler = path.join(rootDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const rawProjects = command(process.execPath, [wrangler, 'pages', 'project', 'list', '--json'], 'Checking existing Cloudflare Pages project');
  let projects;
  try { projects = JSON.parse(rawProjects); } catch {
    throw new Error('Cannot verify the Cloudflare Pages project list. Deployment stopped before upload.');
  }
  const matches = Array.isArray(projects) ? projects.filter(project =>
    project && project['Project Name'] === PROJECT_NAME &&
    typeof project['Project Domains'] === 'string' &&
    project['Project Domains'].split(',').map(domain => domain.trim()).includes(PROJECT_DOMAIN)
  ) : [];
  if (matches.length !== 1) {
    throw new Error(`ไม่พบสิทธิ์เข้าถึงเว็บเดิม ${PROJECT_DOMAIN} ในบัญชี Cloudflare นี้ จึงหยุดก่อนอัปโหลดและไม่สร้างโปรเจกต์ใหม่ / Existing project ${PROJECT_NAME} with domain ${PROJECT_DOMAIN} is required. Sign in to the owning Cloudflare account or obtain access.`);
  }

  command(process.execPath, [wrangler, 'pages', 'deploy', 'dist', `--project-name=${PROJECT_NAME}`, '--branch=main'], 'Cloudflare Pages deployment', { stdio: 'inherit' });
}

if (require.main === module) {
  try { deploySite(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { deploySite, PROJECT_NAME, PROJECT_DOMAIN };
