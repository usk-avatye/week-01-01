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
import { observeResources } from './resources.mjs';
import { requireTestDatabase } from './fixture.mjs';
import { poolSchedule } from './pool-protocol.mjs';
import { fingerprint } from './fingerprint.mjs';

const args = new Map();
for (let at = 2; at < process.argv.length; at += 2) args.set(process.argv[at], process.argv[at + 1]);
const label = args.get('--label') ?? 'pool-size-experiment';
assert.match(label, /^[a-z][a-z0-9-]*$/);
const operations = Number(args.get('--operations') ?? 12000), warmup = Number(args.get('--warmup') ?? 2000), repeats = Number(args.get('--repeats') ?? 3);
assert.ok(Number.isInteger(operations) && operations >= 60);
assert.ok(Number.isInteger(warmup) && warmup >= 60);
const schedule = poolSchedule(repeats), output = `performance/results/${label}`;
await mkdir(output, { recursive: true });
try { await readFile(`${output}/manifest.json`); throw new Error(`Output ${label} already exists; use a fresh label`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const source = await fingerprint(['src/server', 'src/contracts', 'db']);
const compiled = await fingerprint(['dist/src/server', 'dist/src/contracts']);
const harnessSources = (await fingerprint(['performance'], '.mjs')).sources;
const manifest = { label, startedAt: new Date().toISOString(), gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    source, compiled, harness: harnessSources, protocol: { operations, warmup, repeats, concurrency: 60, scenarios: ['C', 'D'],
        poolSizes: [10, 30, 60], schedule, loadModel: 'closed-loop HTTP/1.1 keep-alive; no retry; new API process and schema for each case',
        amountWon: 1, campaignBudgetWon: 1000000000, monitorIntervalMs: 100, poolSampleIntervalMs: 20, resourceIntervalMs: 250 },
    runtime: { node: process.version, platform: process.platform, architecture: process.arch, cpuModel: os.cpus()[0]?.model,
        logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() } };
await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
const index = [];
for (const config of schedule) {
    console.log(JSON.stringify({ event: 'start', label, ...config, at: new Date().toISOString() }));
    let api, observer, requester, postgresMonitor, resourceMonitor;
    try {
        api = await startServer({ poolMax: config.poolMax });
        assert.equal(api.info.poolMax, config.poolMax);
        const observerUrl = new URL(requireTestDatabase(process.env.TEST_DATABASE_URL));
        observerUrl.searchParams.set('application_name', `pool_observer_${api.info.schema}`);
        observer = new pg.Pool({ connectionString: observerUrl.toString(), max: 1 });
        const bootstrap = createRequester(api.info.url, 1);
        const signup = await bootstrap.request('POST', '/api/auth/signup', { email: 'pool@example.test', password: 'Performance-Local-2026!', displayName: 'Pool' });
        assert.equal(signup.status, 201);
        const login = await bootstrap.request('POST', '/api/auth/login', { email: 'pool@example.test', password: 'Performance-Local-2026!' });
        bootstrap.close(); assert.equal(login.status, 200);
        const fixture = await api.call('fixture', { scenario: config.scenario, ownerId: signup.data.id, count: warmup + operations });
        requester = createRequester(api.info.url, 60, { cookie: login.cookie, csrfToken: login.data.csrfToken });
        const warm = await load(requester, { ...config, count: warmup, offset: 0, ...fixture });
        assert.equal(warm.summary.errors, 0);
        await api.call('stabilize');
        resourceMonitor = await observeResources(observer, 250, api.info.applicationName);
        await api.call('start');
        postgresMonitor = observePostgres(observer, api.info.applicationName);
        const measured = await load(requester, { ...config, count: operations, offset: warmup, ...fixture });
        const telemetry = await api.call('stop');
        const postgres = await postgresMonitor.stop(); postgresMonitor = undefined;
        const resources = await resourceMonitor.stop(); resourceMonitor = undefined;
        requester.close(); requester = undefined;
        const invariant = await api.call('validate', { scenario: config.scenario, count: warmup + operations });
        const result = { label, ...config, at: new Date().toISOString(), api: api.info,
            fixture: { fixtureMs: fixture.fixtureMs }, warmup: { workItems: warmup, ...warm.summary }, measurement: measured,
            telemetry, postgres, resources, invariant };
        const raw = gzipSync(Buffer.from(JSON.stringify(result)));
        await writeFile(`${output}/${config.caseId}.json.gz`, raw);
        const summary = { ...config, ...measured.summary, workItemsPerSecond: measured.workItemsPerSecond, operations: measured.operations,
            cpuOneCorePercent: telemetry.cpuOneCorePercent, generatorCpuOneCorePercent: measured.generatorCpuOneCorePercent,
            apiRssBytes: telemetry.rssBytes, poolMaxUsed: telemetry.maxUsed, poolMaxWaiting: telemetry.maxWaiting,
            poolWaitingSampleRate: telemetry.waitingSampleRate, acquireP95Ms: telemetry.acquire.p95Ms, acquireP99Ms: telemetry.acquire.p99Ms,
            postgres: postgres.summary, resources: resources.summary, invariant, rawSha256: createHash('sha256').update(raw).digest('hex') };
        index.push(summary); await writeFile(`${output}/index.json`, JSON.stringify(index, null, 2) + '\n');
        console.log(JSON.stringify({ event: 'done', caseId: config.caseId, rps: summary.rps, p95Ms: summary.p95Ms, p99Ms: summary.p99Ms,
            errors: summary.errors, poolWaiting: summary.poolMaxWaiting, acquireP95Ms: summary.acquireP95Ms,
            lockFraction: summary.postgres.lockWaitingBackendFraction, dbCpu: summary.resources.cpuOneCorePercent }));
        assert.equal(measured.summary.errors, 0); assert.equal(postgres.errors.length, 0); assert.equal(resources.errors.length, 0);
        assert.ok(resources.samples.length >= 2);
        assert.equal(measured.summary.requests, config.scenario === 'D' ? operations * 2 : operations);
    } finally {
        if (postgresMonitor) await postgresMonitor.stop();
        if (resourceMonitor) await resourceMonitor.stop();
        requester?.close();
        if (observer) await observer.end();
        if (api) { await api.close(); await writeFile(`${output}/${config.caseId}-api.txt`, api.logs.join('')); }
    }
}
assert.equal((await fingerprint(['src/server', 'src/contracts', 'db'])).digest, source.digest, 'API or schema changed during experiment');
assert.equal((await fingerprint(['dist/src/server', 'dist/src/contracts'])).digest, compiled.digest, 'Compiled API changed during experiment');
for (const entry of harnessSources) assert.equal(createHash('sha256').update(await readFile(entry.path)).digest('hex'), entry.sha256, 'Harness changed during experiment');
manifest.finishedAt = new Date().toISOString(); manifest.completedCases = index.length;
await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
