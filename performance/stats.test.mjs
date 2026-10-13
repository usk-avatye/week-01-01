import assert from 'node:assert/strict';
import test from 'node:test';
import { summarize, percentile, describeWaits } from './stats.mjs';

test('nearest-rank percentiles preserve the measured tail and throughput uses elapsed wall time', () => {
    const requests = Array.from({ length: 100 }, (_, index) => ({ latencyMs: index + 1, error: index < 2 }));
    const result = summarize(requests, 2000);
    assert.equal(result.rps, 50);
    assert.equal(result.successfulRps, 49);
    assert.equal(result.errorRate, 0.02);
    assert.equal(result.p50Ms, 50);
    assert.equal(result.p95Ms, 95);
    assert.equal(result.p99Ms, 99);
});
test('empty samples and invalid elapsed time cannot produce a successful measurement', () => {
    assert.throws(() => summarize([], 1000));
    assert.throws(() => summarize([{ latencyMs: 1, error: false }], 0));
    assert.equal(percentile([3, 1, 2], 0.99), 3);
});
test('pool wait summaries distinguish zero waiting from actual acquire latency', () => {
    assert.deepEqual(describeWaits([0, 0, 0]), { count: 3, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 });
    assert.equal(describeWaits([0, 1, 2, 10]).p95Ms, 10);
});
