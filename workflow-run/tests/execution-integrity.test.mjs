import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('../scripts/run.mjs', import.meta.url));

async function runCase(t, backendBody, { largePrompt = false, earlyReturn = false, agentOptions = {} } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'workflow-integrity-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const executable = join(directory, 'claude');
  writeFileSync(executable, `#!${process.execPath}\n${backendBody}\n`, { mode: 0o755 });
  const workflow = join(directory, 'case.workflow.js');
  const prompt = largePrompt ? '"review".repeat(400000)' : '"review"';
  writeFileSync(workflow, `${earlyReturn ? '' : 'return await '}agent(${prompt}, {
    ...${JSON.stringify(agentOptions)},
    schema: {type:'object',required:['verdict'],properties:{verdict:{type:'string'}}}
  });${earlyReturn ? 'return {planned:true};' : ''}`);
  const statusPath = join(directory, 'status.json');
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, workflow, '--backend', 'claude', '--status-file', statusPath], {
      env: { ...process.env, TEST_STATUS: statusPath,
        PATH: [directory, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('runner exceeded test deadline')); }, 10000);
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  return { ...result, status: JSON.parse(readFileSync(statusPath, 'utf8')) };
}

test('a successful review stays completed after the CLI recovers from rate limiting', async t => {
  const result = await runCase(t, `
    console.error('warning: previous request rate limited; retry succeeded');
    console.log(JSON.stringify({structured_output:{verdict:'PASS'}}));
  `);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { verdict: 'PASS' });
  assert.equal(result.status.status, 'completed');
  assert.equal(result.status.agents[0].error_code, null);
});

test('a CLI that closes stdin early still records its authentication failure', async t => {
  const result = await runCase(t, `
    process.stdin.destroy();
    console.log(JSON.stringify({is_error:true,result:'Please run /login'}));
    setTimeout(() => process.exit(0), 100);
  `, { largePrompt: true });
  assert.equal(result.code, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout), null);
  assert.equal(result.status.status, 'blocked');
  assert.equal(result.status.agents[0].error_code, 'AUTH_REQUIRED');
});

test('a run never overwrites a sidecar that has been replaced by another owner', async t => {
  const foreign = { run_id: 'foreign-run', content: 'must preserve' };
  const result = await runCase(t, `
    require('node:fs').writeFileSync(process.env.TEST_STATUS, ${JSON.stringify(JSON.stringify(foreign))});
    console.log(JSON.stringify({structured_output:{verdict:'PASS'}}));
  `);
  assert.notEqual(result.code, 0, result.stderr);
  assert.deepEqual(result.status, foreign);
});

test('workflow completion waits for agent calls even when the script returns early', async t => {
  const result = await runCase(t, `
    setTimeout(() => console.log(JSON.stringify({structured_output:{verdict:'PASS'}})), 200);
  `, { earlyReturn: true });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { planned: true });
  assert.equal(result.status.agents.length, 1);
  assert.equal(result.status.agents[0].status, 'completed');
  assert.equal(result.status.status, 'completed');
});

test('the installed Claude OAuth expiry diagnostic is an actionable authentication block', async t => {
  const result = await runCase(t, `
    console.log(JSON.stringify({type:'result',subtype:'success',is_error:true,
      result:'Failed to authenticate: OAuth session expired and could not be refreshed'}));
    process.exit(1);
  `);
  assert.equal(result.code, 2, result.stderr);
  assert.equal(result.status.status, 'blocked');
  assert.equal(result.status.agents[0].error_code, 'AUTH_REQUIRED');
});

test('an unsupported explicitly requested backend never falls back to the default provider', async t => {
  const result = await runCase(t, `
    console.log(JSON.stringify({structured_output:{verdict:'PASS'}}));
  `, { agentOptions: { backend: 'unsupported-provider', model: 'required-model' } });
  assert.equal(result.code, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout), null);
  assert.equal(result.status.agents[0].backend, 'unsupported-provider');
  assert.equal(result.status.agents[0].status, 'blocked');
  assert.equal(result.status.agents[0].error_code, 'BACKEND_UNAVAILABLE');
});
