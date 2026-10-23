'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { deploySite, PROJECT_NAME, PROJECT_DOMAIN } = require('../scripts/deploy-site');

function harness({ branch = 'main', status = '', projects = [], listExit = 0 } = {}) {
  const calls = [];
  return {
    calls,
    run(executable, args, options) {
      calls.push({ executable, args, options });
      if (executable === 'git') return { status: 0, stdout: args[0] === 'symbolic-ref' ? branch : status };
      if (args.includes('list')) return { status: listExit, stdout: JSON.stringify(projects) };
      return { status: 0, stdout: '' };
    },
  };
}

const realProject = { 'Project Name': PROJECT_NAME, 'Project Domains': `custom.example, ${PROJECT_DOMAIN}` };
const rootDir = path.resolve(__dirname, '..');
const environment = { CLOUDFLARE_ACCOUNT_ID: 'test-account', WRANGLER_SEND_METRICS: 'false', CI: '0' };
const cases = [
  ['missing project', {}, /Existing project/],
  ['different project name', { projects: [{ ...realProject, 'Project Name': 'other-site' }] }, /Existing project/],
  ['lookalike domain', { projects: [{ ...realProject, 'Project Domains': `${PROJECT_DOMAIN}.example` }] }, /Existing project/],
  ['wrong branch', { branch: 'feature/ui', projects: [realProject] }, /branch main/],
  ['tracked changes', { status: ' M index.html\n', projects: [realProject] }, /Commit source changes/],
  ['untracked source', { status: '?? private-slip.jpg\n', projects: [realProject] }, /Commit source changes/],
  ['Cloudflare lookup failure', { listExit: 1 }, /Checking existing Cloudflare Pages project failed/],
];

for (const [name, inputs, expectedError] of cases) {
  const mock = harness(inputs);
  assert.throws(() => deploySite({ rootDir, run: mock.run, environment }), expectedError);
  assert.ok(!mock.calls.some(call => call.args.includes('deploy')), `${name} must never publish`);
  console.log(`PASS: ${name} prevents upload`);
}

const mock = harness({ projects: [realProject] });
deploySite({ rootDir, run: mock.run, environment });
const cloudflareCalls = mock.calls.filter(call => call.executable === process.execPath);
assert.equal(cloudflareCalls.length, 2);
assert.deepEqual(cloudflareCalls[1].args, [path.join(rootDir, 'node_modules/wrangler/bin/wrangler.js'), 'pages', 'deploy', 'dist', `--project-name=${PROJECT_NAME}`, '--branch=main']);
assert.equal(cloudflareCalls[1].options.stdio, 'inherit');
assert.strictEqual(cloudflareCalls[0].options.env, cloudflareCalls[1].options.env);
for (const call of cloudflareCalls) {
  assert.equal(call.options.cwd, rootDir);
  assert.equal(call.options.env.CI, '1');
  assert.equal(call.options.env.CLOUDFLARE_ACCOUNT_ID, 'test-account');
}
assert.equal(environment.CI, '0', 'must not mutate the caller environment');
assert.ok(mock.calls.some(call => call.args.includes('--untracked-files=all')));
console.log('PASS: only exact existing target publishes, with shared account context and noninteractive execution');
