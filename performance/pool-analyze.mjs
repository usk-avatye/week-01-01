import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { aggregate, compare } from './analysis.mjs';
import { percentile, describeWaits, summarize } from './stats.mjs';
import { summarizeResourceSamples } from './resources.mjs';
import { poolSchedule } from './pool-protocol.mjs';

const label = process.argv[2] ?? 'pool-size-experiment';
assert.match(label, /^[a-z][a-z0-9-]*$/);
const directory = `performance/results/${label}`;
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`));
const index = JSON.parse(await readFile(`${directory}/index.json`));
const protocol = manifest.protocol;
const concurrencies = protocol.concurrencies ?? [protocol.concurrency];
assert.deepEqual(protocol.schedule, poolSchedule(protocol.repeats, protocol.scenarios, protocol.poolSizes, concurrencies));
assert.equal(index.length, protocol.schedule.length);
assert.equal(manifest.completedCases, index.length);
assert.ok(manifest.finishedAt);
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = values => percentile(values, .5);
const change = (before, after) => (after / before - 1) * 100;
const originals = new Map();
for (const [position, row] of index.entries()) {
    const configuration = protocol.schedule[position];
    for (const key of Object.keys(configuration)) assert.equal(row[key], configuration[key]);
    const compressed = await readFile(`${directory}/${row.caseId}.json.gz`);
    assert.equal(createHash('sha256').update(compressed).digest('hex'), row.rawSha256);
    const raw = JSON.parse(gunzipSync(compressed));
    for (const key of Object.keys(configuration)) assert.equal(raw[key], configuration[key]);
    assert.equal(raw.api.poolMax, row.poolMax);
    assert.equal(raw.telemetry.poolMax, row.poolMax);
    assert.equal(raw.api.settings.server_version, '18.4');
    assert.equal(raw.warmup.workItems, protocol.warmup);
    assert.equal(raw.warmup.errors, 0);
    assert.equal(raw.measurement.workItems, protocol.operations);
    const expectedHttp = protocol.operations * (row.scenario === 'D' ? 2 : 1);
    assert.equal(raw.measurement.records.length, expectedHttp);
    assert.deepEqual(summarize(raw.measurement.records, raw.measurement.summary.elapsedMs), raw.measurement.summary);
    for (const key of Object.keys(raw.measurement.summary)) assert.equal(row[key], raw.measurement.summary[key]);
    assert.equal(row.workItemsPerSecond, protocol.operations * 1000 / row.elapsedMs);
    assert.equal(row.errors, 0);
    assert.equal(raw.postgres.errors.length, 0);
    assert.equal(raw.resources.errors.length, 0);
    assert.ok(raw.resources.samples.length >= 2);
    const resourceSummary = summarizeResourceSamples(raw.resources.samples);
    for (const [key, value] of Object.entries(resourceSummary)) assert.equal(value, row.resources[key]);
    assert.equal(raw.resources.summary.externalActiveObservations, 0);
    assert.deepEqual(raw.telemetry.acquire, describeWaits(raw.telemetry.acquireMs));
    assert.equal(row.acquireP95Ms, raw.telemetry.acquire.p95Ms);
    assert.equal(row.acquireP99Ms, raw.telemetry.acquire.p99Ms);
    assert.equal(row.poolMaxUsed, Math.max(...raw.telemetry.samples.map(sample => sample.used)));
    assert.equal(row.poolMaxWaiting, Math.max(...raw.telemetry.samples.map(sample => sample.waiting)));
    assert.equal(row.poolWaitingSampleRate, raw.telemetry.samples.filter(sample => sample.waiting > 0).length / raw.telemetry.samples.length);
    for (const [operation, stats] of Object.entries(row.operations)) {
        assert.deepEqual(stats, summarize(raw.measurement.records.filter(record => record.operation === operation), row.elapsedMs));
        assert.equal(stats.requests, protocol.operations);
    }
    assert.equal(raw.invariant.consistent, true);
    assert.equal(raw.invariant.campaigns, row.scenario === 'B' ? 10 : 1);
    const total = protocol.operations + protocol.warmup;
    assert.deepEqual(raw.invariant.totals, { spent: row.scenario === 'C' ? 0 : total, records: total,
        approved: row.scenario === 'C' ? 0 : total, prepared: row.scenario === 'C' ? total : 0, rejected: 0 });
    if (row.scenario === 'B') {
        assert.equal(raw.fixture.campaigns.length, 10);
        assert.equal(raw.fixture.sqlPreparedRows, total);
        assert.equal(raw.invariant.perCampaign.length, 10);
        for (const [at, campaign] of raw.invariant.perCampaign.entries()) {
            const expected = Math.ceil((total - at) / 10);
            assert.equal(campaign.spent_amount, String(expected));
            assert.equal(campaign.ledger, String(expected));
            assert.equal(campaign.approved, expected);
        }
    }
    originals.set(row.caseId, raw);
}
const groups = [];
for (const scenario of protocol.scenarios) for (const poolMax of protocol.poolSizes) for (const concurrency of concurrencies) {
    const rows = index.filter(row => row.scenario === scenario && row.poolMax === poolMax && row.concurrency === concurrency);
    assert.equal(rows.length, protocol.repeats);
    assert.deepEqual(rows.map(row => row.repeat).sort(), Array.from({ length: protocol.repeats }, (_, at) => at + 1));
    const originalsInGroup = rows.map(row => originals.get(row.caseId));
    const endpoints = Object.fromEntries(Object.keys(rows[0].operations).map(operation => [operation,
        Object.fromEntries(['p50Ms', 'p95Ms', 'p99Ms'].map(key => [key, median(rows.map(row => row.operations[operation][key]))]))]));
    const lockQueries = {}, waitEvents = {};
    for (const raw of originalsInGroup) for (const sample of raw.postgres.samples) for (const activity of sample.activity) {
        if (activity.wait_event_type && activity.state !== 'idle') {
            const key = `${activity.wait_event_type}:${activity.wait_event}`;
            waitEvents[key] = (waitEvents[key] ?? 0) + 1;
        }
        if (activity.wait_event_type === 'Lock') lockQueries[activity.query] = (lockQueries[activity.query] ?? 0) + 1;
    }
    groups.push({ ...aggregate(rows), poolMax, acquireP99Ms: median(rows.map(row => row.acquireP99Ms)), endpoints,
        dbCpuOneCorePercent: mean(rows.map(row => row.resources.cpuOneCorePercent)),
        dbCpuOneCorePercentMin: Math.min(...rows.map(row => row.resources.cpuOneCorePercent)),
        dbCpuOneCorePercentMax: Math.max(...rows.map(row => row.resources.cpuOneCorePercent)),
        apiRssEndMiB: mean(rows.map(row => row.apiRssBytes / 2 ** 20)),
        dbAggregateRssPeakMiB: mean(rows.map(row => row.resources.maxAggregateRssBytes / 2 ** 20)),
        dbMaxProcesses: Math.max(...rows.map(row => row.resources.maxProcesses)),
        resourceSamples: originalsInGroup.reduce((sum, raw) => sum + raw.resources.samples.length, 0),
        postgresSamples: originalsInGroup.reduce((sum, raw) => sum + raw.postgres.samples.length, 0),
        eventLoopP99Ms: median(originalsInGroup.map(raw => raw.telemetry.eventLoop.p99Ms)),
        waitEvents, lockQueries,
        trials: rows.map(row => ({ ...row, resourceWindowToHttpElapsedRatio: row.resources.elapsedMs / row.elapsedMs })) });
}
const comparisons = groups.filter(group => group.poolMax !== 30 && protocol.poolSizes.includes(30)).map(group => {
    const baseline = groups.find(row => row.scenario === group.scenario && row.poolMax === 30 && row.concurrency === group.concurrency);
    const paired = group.trials.map(row => {
        const before = baseline.trials.find(candidate => candidate.repeat === row.repeat);
        return { repeat: row.repeat, rpsChangePercent: change(before.rps, row.rps),
            executeP95ChangePercent: row.operations.execute ? change(before.operations.execute.p95Ms, row.operations.execute.p95Ms) : null,
            executeP99ChangePercent: row.operations.execute ? change(before.operations.execute.p99Ms, row.operations.execute.p99Ms) : null };
    });
    return { ...compare(baseline, group), baselinePoolMax: 30, poolMax: group.poolMax,
        executeP95ChangePercent: group.endpoints.execute ? change(baseline.endpoints.execute.p95Ms, group.endpoints.execute.p95Ms) : null,
        executeP99ChangePercent: group.endpoints.execute ? change(baseline.endpoints.execute.p99Ms, group.endpoints.execute.p99Ms) : null,
        prepareP95ChangePercent: group.endpoints.prepare ? change(baseline.endpoints.prepare.p95Ms, group.endpoints.prepare.p95Ms) : null,
        prepareP99ChangePercent: group.endpoints.prepare ? change(baseline.endpoints.prepare.p99Ms, group.endpoints.prepare.p99Ms) : null,
        dbCpuChangePercent: change(baseline.dbCpuOneCorePercent, group.dbCpuOneCorePercent),
        dbAggregateRssPeakChangePercent: change(baseline.dbAggregateRssPeakMiB, group.dbAggregateRssPeakMiB),
        rpsRangesOverlap: group.rpsMin <= baseline.rpsMax && baseline.rpsMin <= group.rpsMax, paired };
});
const report = { label, verifiedCases: index.length, measuredHttpRequests: index.reduce((sum, row) => sum + row.requests, 0),
    measuredWorkItems: index.length * protocol.operations, errors: 0,
    aggregation: 'arithmetic mean trial RPS/CPU/peak RSS; median trial quantiles; mean sampled lock fraction per trial', groups };
await writeFile(`${directory}/summary.json`, JSON.stringify(report, null, 2) + '\n');
await writeFile(`${directory}/comparison.json`, JSON.stringify({ baselinePoolMax: 30, comparisons }, null, 2) + '\n');
const columns = ['scenario', 'poolMax', 'concurrency', 'rps', 'rpsMin', 'rpsMax', 'rpsCv', 'workItemsPerSecond',
    'p50Ms', 'p95Ms', 'p99Ms', 'errorRate', 'acquireP95Ms', 'acquireP99Ms', 'poolMaxUsed', 'poolMaxWaiting',
    'poolWaitingSampleRate', 'lockWaitingBackendFraction', 'cpuOneCorePercent', 'dbCpuOneCorePercent', 'apiRssEndMiB', 'dbAggregateRssPeakMiB'];
await writeFile(`${directory}/summary.csv`, [columns.join(','), ...groups.map(row => columns.map(key => row[key]).join(','))].join('\n') + '\n');
console.table(groups.map(row => ({ scenario: row.scenario, concurrency: row.concurrency, pool: row.poolMax, rps: row.rps.toFixed(1),
    p95: row.p95Ms.toFixed(2), p99: row.p99Ms.toFixed(2), executeP99: row.endpoints.execute?.p99Ms.toFixed(2),
    acquireP95: row.acquireP95Ms.toFixed(3), dbCpu: row.dbCpuOneCorePercent.toFixed(1), errors: row.errors })));
console.log(`Verified ${report.verifiedCases} cases, ${report.measuredHttpRequests} HTTP requests`);
