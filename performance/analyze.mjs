import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { aggregate, compare } from './analysis.mjs';
import { percentile, summarize } from './stats.mjs';

const labels = process.argv.slice(2);
assert.ok(labels.length > 0 && labels.every(label => /^[a-z][a-z0-9-]*$/.test(label)));
const reports = [];
for (const label of labels) {
    const directory = `performance/results/${label}`;
    const manifest = JSON.parse(await readFile(`${directory}/manifest.json`));
    const index = JSON.parse(await readFile(`${directory}/index.json`));
    assert.equal(index.length, manifest.protocol.schedule.length);
    assert.equal(manifest.completedCases, index.length);
    const groups = [];
    for (const scenario of manifest.protocol.scenarios) for (const concurrency of manifest.protocol.concurrencies) {
        const rows = index.filter(row => row.scenario === scenario && row.concurrency === concurrency);
        assert.equal(rows.length, manifest.protocol.repeats);
        const group = aggregate(rows);
        const waits = {}, queries = {}, modes = {}, endpoints = {}, loops = [], observers = [], lockAges = [];
        let sampleCount = 0;
        for (const row of rows) {
            const compressed = await readFile(`${directory}/${row.caseId}.json.gz`);
            assert.equal(createHash('sha256').update(compressed).digest('hex'), row.rawSha256);
            const raw = JSON.parse(gunzipSync(compressed));
            assert.equal(raw.measurement.records.length, raw.measurement.summary.requests);
            assert.deepEqual(summarize(raw.measurement.records, raw.measurement.summary.elapsedMs), raw.measurement.summary);
            for (const key of ['rps', 'p50Ms', 'p95Ms', 'p99Ms', 'requests', 'errors']) assert.equal(raw.measurement.summary[key], row[key]);
            assert.equal(raw.postgres.errors.length, 0);
            assert.equal(raw.measurement.summary.errors, 0);
            for (const [name, stats] of Object.entries(raw.measurement.operations)) (endpoints[name] ??= []).push(stats);
            loops.push(raw.telemetry.eventLoop.p99Ms);
            observers.push(raw.postgres.summary.observerQueryMs.p95Ms);
            for (const sample of raw.postgres.samples) {
                sampleCount++;
                for (const activity of sample.activity) {
                    if (activity.wait_event_type && activity.state !== 'idle') {
                        const key = `${activity.wait_event_type}:${activity.wait_event}`;
                        waits[key] = (waits[key] ?? 0) + 1;
                    }
                    if (activity.wait_event_type === 'Lock') {
                        queries[activity.query] = (queries[activity.query] ?? 0) + 1;
                        lockAges.push(Number(activity.query_age_ms));
                    }
                }
                for (const lock of sample.locks) {
                    const key = `${lock.locktype}:${lock.mode}:${lock.relname ?? ''}`;
                    modes[key] = (modes[key] ?? 0) + 1;
                }
            }
        }
        groups.push({ ...group, sampleCount, waitEvents: waits, lockQueries: queries, lockModes: modes,
            waitingQueryAgeP95Ms: percentile(lockAges, 0.95), eventLoopP99Ms: percentile(loops, 0.5),
            observerQueryP95Ms: percentile(observers, 0.5),
            endpoints: Object.fromEntries(Object.entries(endpoints).map(([name, stats]) => [name,
                { p50Ms: percentile(stats.map(s => s.p50Ms), 0.5), p95Ms: percentile(stats.map(s => s.p95Ms), 0.5),
                    p99Ms: percentile(stats.map(s => s.p99Ms), 0.5) }])) });
    }
    const report = { label, aggregation: 'arithmetic mean trial RPS; median trial quantiles; mean trial sampled lock fractions', groups };
    await writeFile(`${directory}/summary.json`, JSON.stringify(report, null, 2) + '\n');
    const columns = ['scenario', 'concurrency', 'rps', 'rpsMin', 'rpsMax', 'rpsCv', 'p50Ms', 'p95Ms', 'p99Ms', 'errorRate',
        'lockWaitingBackendFraction', 'poolMaxUsed', 'poolMaxWaiting', 'acquireP95Ms', 'workItemsPerSecond'];
    await writeFile(`${directory}/summary.csv`, [columns.join(','), ...groups.map(row => columns.map(key => row[key]).join(','))].join('\n') + '\n');
    console.log(label);
    console.table(groups.map(row => ({ scenario: row.scenario, c: row.concurrency, rps: row.rps.toFixed(1),
        p95: row.p95Ms.toFixed(2), p99: row.p99Ms.toFixed(2), lock: (row.lockWaitingBackendFraction * 100).toFixed(1),
        queue: row.poolMaxWaiting, errors: row.errors })));
    reports.push({ manifest, report });
}
if (reports.length === 2) {
    assert.deepEqual(reports[0].manifest.protocol, reports[1].manifest.protocol);
    assert.deepEqual(reports[0].manifest.harness, reports[1].manifest.harness);
    const comparisons = reports[0].report.groups.map((before, index) => compare(before, reports[1].report.groups[index]));
    await writeFile(`performance/results/${labels[1]}/comparison-${labels[0]}.json`, JSON.stringify({ before: labels[0], after: labels[1], comparisons }, null, 2) + '\n');
    console.table(comparisons);
}
