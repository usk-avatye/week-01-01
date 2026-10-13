import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import pg from 'pg';
import { startServer } from './control.mjs';
import { createRequester, load } from './http.mjs';
import { observePostgres } from './telemetry.mjs';
import { requireTestDatabase } from './fixture.mjs';

const argumentsMap = new Map();
for (let index = 2; index < process.argv.length; index += 2) argumentsMap.set(process.argv[index], process.argv[index + 1]);
const label = argumentsMap.get('--label') ?? 'baseline';
assert.match(label, /^[a-z][a-z0-9-]*$/);
const operations = Number(argumentsMap.get('--operations') ?? 12000);
const warmup = Number(argumentsMap.get('--warmup') ?? 2000);
const repeats = Number(argumentsMap.get('--repeats') ?? 3);
const scenarios = (argumentsMap.get('--scenarios') ?? 'A,B,C,D').split(',');
const concurrencies = (argumentsMap.get('--concurrency') ?? '1,10,30,60').split(',').map(Number);
assert.ok(scenarios.every(value => ['A', 'B', 'C', 'D'].includes(value)));
assert.ok(concurrencies.every(value => Number.isInteger(value) && value > 0 && value <= 60));
assert.ok(Number.isInteger(operations) && operations >= Math.max(...concurrencies));
assert.ok(Number.isInteger(warmup) && warmup >= Math.max(...concurrencies));
assert.ok(Number.isInteger(repeats) && repeats > 0);
const output = `performance/results/${label}`;
await mkdir(output, { recursive: true });
try { await readFile(`${output}/manifest.json`); throw new Error(`Output ${label} already exists; use a fresh label`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

async function fingerprint(directories = ['src', 'db']) {
    const names = execFileSync('rg', ['--files', ...directories], { encoding: 'utf8' }).trim().split('\n').sort();
    const sources = [];
    for (const name of names) sources.push({ path: name, sha256: createHash('sha256').update(await readFile(name)).digest('hex') });
    return { digest: createHash('sha256').update(JSON.stringify(sources)).digest('hex'), sources };
}
function order() {
    const configs = scenarios.flatMap(scenario => concurrencies.map(concurrency => ({ scenario, concurrency })));
    let seed = 20261013;
    function random() { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; }
    const result = [];
    for (let repeat = 1; repeat <= repeats; repeat++) {
        const shuffled = [...configs];
        for (let index = shuffled.length - 1; index > 0; index--) { const at = Math.floor(random() * (index + 1)); [shuffled[index], shuffled[at]] = [shuffled[at], shuffled[index]]; }
        result.push(...shuffled.map(config => ({ ...config, repeat })));
    }
    return result;
}
const api = await startServer();
const observerUrl = new URL(requireTestDatabase(process.env.TEST_DATABASE_URL));
observerUrl.searchParams.set('application_name', `load_observer_${api.info.schema}`);
const observerPool = new pg.Pool({ connectionString: observerUrl.toString(), max: 1 });
const source = await fingerprint();
const compiled = await fingerprint(['dist/src/server', 'dist/src/contracts']);
const harness = {};
for (const name of ['control', 'fixture', 'http', 'runner', 'server', 'stats', 'telemetry'])
    harness[name] = createHash('sha256').update(await readFile(`performance/${name}.mjs`)).digest('hex');
await observerPool.query('SELECT 1');
const schedule = order();
const manifest = { label, startedAt: new Date().toISOString(), gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    source, compiled, harness, protocol: { operations, warmup, repeats, scenarios, concurrencies, seed: 20261013, schedule,
        loadModel: 'closed-loop, HTTP/1.1 keep-alive, fixed work count, no retries', latencyQuantile: 'nearest-rank',
        amountWon: 1, campaignBudgetWon: 1000000000, monitorIntervalMs: 100, poolSampleIntervalMs: 20 },
    runtime: { node: process.version, platform: process.platform, architecture: process.arch,
        cpuModel: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() }, api: api.info };
await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
const index = [];
try {
    const bootstrap = createRequester(api.info.url, 1);
    const signup = await bootstrap.request('POST', '/api/auth/signup', { email: 'performance@example.test', password: 'Performance-Local-2026!', displayName: 'Performance' });
    assert.equal(signup.status, 201);
    const login = await bootstrap.request('POST', '/api/auth/login', { email: 'performance@example.test', password: 'Performance-Local-2026!' });
    assert.equal(login.status, 200); bootstrap.close();
    const credentials = { cookie: login.cookie, csrfToken: login.data.csrfToken };
    for (const config of schedule) {
        const caseId = `${config.scenario}-c${config.concurrency}-r${config.repeat}`;
        console.log(JSON.stringify({ event: 'start', label, caseId, at: new Date().toISOString() }));
        const fixture = await api.call('fixture', { scenario: config.scenario, ownerId: signup.data.id, count: warmup + operations });
        const requester = createRequester(api.info.url, config.concurrency, credentials);
        const warm = await load(requester, { ...config, count: warmup, offset: 0, ...fixture });
        assert.equal(warm.summary.errors, 0);
        await api.call('stabilize');
        await api.call('start');
        const monitor = observePostgres(observerPool, api.info.applicationName);
        let measured, telemetry, postgres;
        try { measured = await load(requester, { ...config, count: operations, offset: warmup, ...fixture }); }
        finally { telemetry = await api.call('stop'); postgres = await monitor.stop(); requester.close(); }
        const invariant = await api.call('validate', { scenario: config.scenario, count: warmup + operations });
        const result = { caseId, label, ...config, at: new Date().toISOString(), fixture: { fixtureMs: fixture.fixtureMs, sqlPreparedRows: fixture.sqlPreparedRows },
            warmup: { workItems: warmup, ...warm.summary }, measurement: measured, telemetry, postgres, invariant };
        const raw = gzipSync(Buffer.from(JSON.stringify(result)));
        await writeFile(`${output}/${caseId}.json.gz`, raw);
        const summary = { caseId, ...config, ...measured.summary, workItemsPerSecond: measured.workItemsPerSecond, operations: measured.operations,
            cpuOneCorePercent: telemetry.cpuOneCorePercent, generatorCpuOneCorePercent: measured.generatorCpuOneCorePercent,
            poolMaxUsed: telemetry.maxUsed, poolMaxWaiting: telemetry.maxWaiting, poolWaitingSampleRate: telemetry.waitingSampleRate,
            acquireP95Ms: telemetry.acquire.p95Ms, postgres: postgres.summary, invariant, rawSha256: createHash('sha256').update(raw).digest('hex') };
        index.push(summary); await writeFile(`${output}/index.json`, JSON.stringify(index, null, 2) + '\n');
        console.log(JSON.stringify({ event: 'done', label, caseId, rps: summary.rps, p95Ms: summary.p95Ms,
            p99Ms: summary.p99Ms, errors: summary.errors, lockFraction: summary.postgres.lockWaitingBackendFraction, poolWaiting: summary.poolMaxWaiting }));
        assert.equal(measured.summary.errors, 0); assert.equal(postgres.errors.length, 0);
        assert.equal(measured.summary.requests, config.scenario === 'D' ? operations * 2 : operations);
    }
    const ending = await fingerprint(); assert.equal(ending.digest, source.digest, 'Runtime sources changed during measurement');
    assert.equal((await fingerprint(['dist/src/server', 'dist/src/contracts'])).digest, compiled.digest, 'Compiled API changed during measurement');
    manifest.finishedAt = new Date().toISOString(); manifest.completedCases = index.length;
    await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
} finally {
    await writeFile(`${output}/api-output.txt`, api.logs.join(''));
    await observerPool.end(); await api.close();
}
