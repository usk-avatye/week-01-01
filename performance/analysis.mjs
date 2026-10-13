import assert from 'node:assert/strict';
import { percentile } from './stats.mjs';

export function aggregate(rows) {
    assert.ok(rows.length > 0);
    const mean = key => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
    const median = key => percentile(rows.map(row => row[key]), 0.5);
    const rps = mean('rps');
    const sd = rows.length > 1 ? Math.sqrt(rows.reduce((sum, row) => sum + (row.rps - rps) ** 2, 0) / (rows.length - 1)) : 0;
    const requests = rows.reduce((sum, row) => sum + row.requests, 0);
    const errors = rows.reduce((sum, row) => sum + row.errors, 0);
    return { scenario: rows[0].scenario, concurrency: rows[0].concurrency, repeats: rows.length,
        rps, rpsMin: Math.min(...rows.map(row => row.rps)), rpsMax: Math.max(...rows.map(row => row.rps)), rpsCv: sd / rps,
        workItemsPerSecond: mean('workItemsPerSecond'), p50Ms: median('p50Ms'), p95Ms: median('p95Ms'), p99Ms: median('p99Ms'),
        requests, errors, errorRate: errors / requests, cpuOneCorePercent: mean('cpuOneCorePercent'),
        generatorCpuOneCorePercent: mean('generatorCpuOneCorePercent'), acquireP95Ms: median('acquireP95Ms'),
        poolMaxUsed: Math.max(...rows.map(row => row.poolMaxUsed)), poolMaxWaiting: Math.max(...rows.map(row => row.poolMaxWaiting)),
        poolWaitingSampleRate: mean('poolWaitingSampleRate'),
        lockWaitingBackendFraction: rows.reduce((sum, row) => sum + row.postgres.lockWaitingBackendFraction, 0) / rows.length,
        maxLockWaiting: Math.max(...rows.map(row => row.postgres.maxLockWaiting)),
        runs: rows.map(row => ({ caseId: row.caseId, rps: row.rps, p95Ms: row.p95Ms, p99Ms: row.p99Ms })) };
}

export function compare(before, after) {
    assert.equal(before.scenario, after.scenario);
    assert.equal(before.concurrency, after.concurrency);
    return { scenario: before.scenario, concurrency: before.concurrency,
        rpsChangePercent: (after.rps / before.rps - 1) * 100,
        p95ChangePercent: (after.p95Ms / before.p95Ms - 1) * 100,
        p99ChangePercent: (after.p99Ms / before.p99Ms - 1) * 100 };
}
