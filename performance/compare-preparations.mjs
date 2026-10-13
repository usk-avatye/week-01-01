import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { preparationComparisonSchedule } from './pool-protocol.mjs';

const baseline = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass the existing baseline checkout directory');
const root = process.cwd();
assert.notEqual(baseline, root);
const prefix = process.argv[3] ?? 'preparations-pool10';
assert.match(prefix, /^[a-z][a-z0-9-]*$/);
const args = new Map();
for (let at = 4; at < process.argv.length; at += 2) args.set(process.argv[at], process.argv[at + 1]);
const operations = Number(args.get('--operations') ?? 12000), warmup = Number(args.get('--warmup') ?? 2000), repeats = Number(args.get('--repeats') ?? 3);
assert.ok(Number.isInteger(operations) && operations >= 60);
assert.ok(Number.isInteger(warmup) && warmup >= 60);
const schedule = preparationComparisonSchedule(repeats);
const output = `performance/results/${prefix}`;
await mkdir(`${output}/verification`, { recursive: true });
try { await readFile(`${output}/manifest.json`); throw new Error(`Output ${prefix} already exists; use a fresh prefix`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const sourceRef = 'd8664e2b89873ed979acbb32b486c3d00571ef7c';
const git = (...argumentsList) => execFileSync('git', argumentsList, { cwd: baseline, encoding: 'utf8' });
assert.equal(git('rev-parse', 'HEAD').trim(), sourceRef);
const original = git('show', `${sourceRef}:src/server/db/pool.ts`);
const adjusted = original.replace('max: 30,', 'max: 10,');
assert.notEqual(adjusted, original);
const poolPath = `${baseline}/src/server/db/pool.ts`;
assert.ok([original, adjusted].includes(await readFile(poolPath, 'utf8')), 'Unexpected baseline pool modification');
await writeFile(poolPath, adjusted);
assert.equal(git('diff', '--name-only', '--', 'src/server', 'src/contracts', 'db').trim(), 'src/server/db/pool.ts');
assert.equal(git('ls-files', '--others', '--exclude-standard', '--', 'src/server', 'src/contracts', 'db').trim(), '');
await writeFile(`${output}/counter-pool10.patch`, git('diff', '--', 'src/server/db/pool.ts'));
await mkdir(`${baseline}/performance`, { recursive: true });
for (const name of await readdir('performance')) if (name.endsWith('.mjs')) await cp(`performance/${name}`, `${baseline}/performance/${name}`);
const compile = execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json'], { cwd: baseline, encoding: 'utf8' });
await writeFile(`${output}/verification/counter-build.txt`, compile + 'TypeScript compilation exit 0\n');
const testOutput = execFileSync(process.execPath, ['--import', 'tsx', `--env-file=${root}/.env`, '--test', '--test-concurrency=1',
    'tests/integration/executions.test.ts', 'tests/integration/locking.test.ts'], { cwd: baseline, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
await writeFile(`${output}/verification/counter-tests.txt`, testOutput);
const manifest = { prefix, startedAt: new Date().toISOString(), sourceRefs: { counter: sourceRef,
    sequence: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() },
    protocol: { scenarios: ['C'], poolSizes: [10], concurrency: 60, operations, warmup, repeats, schedule }, runs: [] };
await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
for (const config of schedule) {
    const directory = config.variant === 'counter' ? baseline : root;
    const label = `${prefix}-${config.variant}-r${config.repeat}`;
    console.log(JSON.stringify({ event: 'start', label, ...config }));
    await new Promise((done, fail) => {
        const child = spawn(process.execPath, [`--env-file=${root}/.env`, 'performance/pool-runner.mjs', '--label', label,
            '--scenarios', 'C', '--pool-max', '10', '--operations', String(operations), '--warmup', String(warmup), '--repeats', '1'],
        { cwd: directory, stdio: 'inherit' });
        child.once('error', fail);
        child.once('exit', code => code === 0 ? done() : fail(new Error(`${label}: exit ${code}`)));
    });
    if (config.variant === 'counter') await cp(`${directory}/performance/results/${label}`, `${root}/performance/results/${label}`, { recursive: true, errorOnExist: true, force: false });
    const index = JSON.parse(await readFile(`performance/results/${label}/index.json`));
    assert.equal(index.length, 1);
    const raw = JSON.parse(gunzipSync(await readFile(`performance/results/${label}/${index[0].caseId}.json.gz`)));
    assert.equal(raw.api.poolMax, 10);
    assert.equal(raw.api.numberStrategy, config.variant);
    manifest.runs.push({ ...config, label });
    await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
}
manifest.finishedAt = new Date().toISOString();
assert.equal(manifest.runs.length, schedule.length);
await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Completed ${manifest.runs.length} preparation comparison cases`);
