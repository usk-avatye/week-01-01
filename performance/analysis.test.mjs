import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregate, compare } from './analysis.mjs';

test('aggregate uses trial mean throughput and median trial percentiles', () => {
    const rows = [1, 2, 3].map(value => ({ scenario: 'C', concurrency: 10, rps: value * 100, workItemsPerSecond: value * 100,
        p50Ms: value, p95Ms: value * 10, p99Ms: value * 20, requests: 100, errors: value === 3 ? 1 : 0,
        cpuOneCorePercent: 20, generatorCpuOneCorePercent: 10, acquireP95Ms: value,
        poolMaxUsed: 10, poolMaxWaiting: 0, poolWaitingSampleRate: 0,
        postgres: { lockWaitingBackendFraction: 0.5, maxLockWaiting: 9 } }));
    const result = aggregate(rows);
    assert.equal(result.rps, 200); assert.equal(result.p95Ms, 20);
    assert.equal(result.rpsCv, 0.5); assert.equal(result.errorRate, 1 / 300);
});
test('comparison distinguishes throughput gains from latency reductions', () => {
    const a = { scenario: 'C', concurrency: 10, rps: 100, p95Ms: 20, p99Ms: 40 };
    const result = compare(a, { ...a, rps: 150, p95Ms: 10, p99Ms: 30 });
    assert.equal(result.rpsChangePercent, 50); assert.equal(result.p95ChangePercent, -50); assert.equal(result.p99ChangePercent, -25);
});
