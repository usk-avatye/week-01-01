import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { aggregate, compare } from './analysis.mjs';
import { percentile } from './stats.mjs';
import { preparationComparisonSchedule } from './pool-protocol.mjs';

const prefix = process.argv[2] ?? 'preparations-pool10';
assert.match(prefix, /^[a-z][a-z0-9-]*$/);
const output = `performance/results/${prefix}`;
const manifest = JSON.parse(await readFile(`${output}/manifest.json`));
const schedule = preparationComparisonSchedule(manifest.protocol.repeats);
assert.deepEqual(manifest.protocol.schedule, schedule);
assert.equal(manifest.runs.length, schedule.length);
assert.ok(manifest.finishedAt);
let commonProtocol, commonHarness, commonRuntime, commonSettings;
const sources = {}, compiled = {}, rows = [];
const apiPids = new Set(), schemas = new Set();
for (const [at, run] of manifest.runs.entries()) {
    const { label, ...configuration } = run;
    assert.deepEqual(configuration, schedule[at]);
    execFileSync(process.execPath, ['performance/pool-analyze.mjs', label], { stdio: 'pipe' });
    const childManifest = JSON.parse(await readFile(`performance/results/${label}/manifest.json`));
    const index = JSON.parse(await readFile(`performance/results/${label}/index.json`));
    assert.equal(index.length, 1);
    assert.equal(childManifest.gitHead, manifest.sourceRefs[run.variant]);
    assert.equal(childManifest.protocol.operations, manifest.protocol.operations);
    assert.equal(childManifest.protocol.warmup, manifest.protocol.warmup);
    assert.deepEqual(childManifest.protocol.scenarios, ['C']);
    assert.deepEqual(childManifest.protocol.poolSizes, [10]);
    assert.equal(childManifest.protocol.concurrency, 60);
    for (const [value, common] of [[childManifest.protocol, commonProtocol], [childManifest.harness, commonHarness], [childManifest.runtime, commonRuntime]]) {
        if (common) assert.deepEqual(value, common);
    }
    commonProtocol ??= childManifest.protocol; commonHarness ??= childManifest.harness; commonRuntime ??= childManifest.runtime;
    const raw = JSON.parse(gunzipSync(await readFile(`performance/results/${label}/${index[0].caseId}.json.gz`)));
    assert.equal(raw.api.poolMax, 10);
    assert.equal(raw.api.numberStrategy, run.variant);
    if (commonSettings) assert.deepEqual(raw.api.settings, commonSettings);
    commonSettings ??= raw.api.settings;
    for (const [collection, value] of [[sources, childManifest.source.digest], [compiled, childManifest.compiled.digest]]) {
        if (collection[run.variant]) assert.equal(value, collection[run.variant]);
        collection[run.variant] ??= value;
    }
    apiPids.add(raw.api.pid); schemas.add(raw.api.schema);
    rows.push({ ...index[0], caseId: label, variant: run.variant, repeat: run.repeat, position: run.position });
}
assert.equal(apiPids.size, schedule.length); assert.equal(schemas.size, schedule.length);
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const groups = ['counter', 'sequence'].map(variant => {
    const cases = rows.filter(row => row.variant === variant);
    assert.deepEqual(cases.map(row => row.repeat), Array.from({ length: manifest.protocol.repeats }, (_, at) => at + 1));
    return { ...aggregate(cases), variant, poolMax: 10, acquireP99Ms: percentile(cases.map(row => row.acquireP99Ms), .5),
        dbCpuOneCorePercent: mean(cases.map(row => row.resources.cpuOneCorePercent)),
        dbCpuMsPerPreparation: mean(cases.map(row => row.resources.cpuMs / row.requests)),
        apiRssEndMiB: mean(cases.map(row => row.apiRssBytes / 2 ** 20)),
        dbAggregateRssPeakMiB: mean(cases.map(row => row.resources.maxAggregateRssBytes / 2 ** 20)), trials: cases };
});
const [before, after] = groups;
const comparison = { ...compare(before, after),
    dbCpuChangePercent: (after.dbCpuOneCorePercent / before.dbCpuOneCorePercent - 1) * 100,
    dbCpuPerPreparationChangePercent: (after.dbCpuMsPerPreparation / before.dbCpuMsPerPreparation - 1) * 100,
    rpsRangesOverlap: before.rpsMin <= after.rpsMax && after.rpsMin <= before.rpsMax,
    paired: after.trials.map(row => { const base = before.trials.find(candidate => candidate.repeat === row.repeat);
        return { repeat: row.repeat, rpsChangePercent: (row.rps / base.rps - 1) * 100,
            p95ChangePercent: (row.p95Ms / base.p95Ms - 1) * 100, p99ChangePercent: (row.p99Ms / base.p99Ms - 1) * 100 }; }) };
const report = { prefix, verifiedCases: rows.length, measuredHttpRequests: rows.reduce((sum, row) => sum + row.requests, 0),
    aggregation: 'arithmetic mean trial RPS/CPU; median trial quantiles', sources, compiled, groups, comparison };
await writeFile(`${output}/summary.json`, JSON.stringify(report, null, 2) + '\n');
const columns = ['variant', 'poolMax', 'concurrency', 'rps', 'rpsMin', 'rpsMax', 'rpsCv', 'p95Ms', 'p99Ms', 'errorRate',
    'acquireP95Ms', 'acquireP99Ms', 'poolMaxWaiting', 'lockWaitingBackendFraction', 'cpuOneCorePercent', 'dbCpuOneCorePercent', 'dbCpuMsPerPreparation'];
await writeFile(`${output}/summary.csv`, [columns.join(','), ...groups.map(row => columns.map(key => row[key]).join(','))].join('\n') + '\n');
console.table(groups.map(row => ({ variant: row.variant, rps: row.rps.toFixed(1), p95: row.p95Ms.toFixed(2), p99: row.p99Ms.toFixed(2),
    lockPercent: (row.lockWaitingBackendFraction * 100).toFixed(1), dbCpu: row.dbCpuOneCorePercent.toFixed(1), errors: row.errors })));
console.log(JSON.stringify(comparison));
