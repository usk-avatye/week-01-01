import assert from 'node:assert/strict';
import test from 'node:test';
import { cpuMilliseconds, summarizeResourceSamples } from './resources.mjs';

test('ps cumulative CPU time parses hundredths, hours and days', () => {
    assert.equal(cpuMilliseconds('0:01.25'), 1250);
    assert.equal(cpuMilliseconds('1:02:03.50'), 3723500);
    assert.equal(cpuMilliseconds('2-01:00:00'), 176400000);
    assert.throws(() => cpuMilliseconds('invalid'));
});
test('DB CPU is the sum of observed per-PID deltas and RSS is explicitly an aggregate', () => {
    const rows = [
        { elapsedMs: 0, processes: [{ pid: 1, cpuMs: 100, rssKiB: 10 }, { pid: 2, cpuMs: 200, rssKiB: 20 }] },
        { elapsedMs: 1000, processes: [{ pid: 1, cpuMs: 600, rssKiB: 15 }, { pid: 2, cpuMs: 700, rssKiB: 25 }] },
    ];
    assert.deepEqual(summarizeResourceSamples(rows), { cpuMs: 1000, elapsedMs: 1000, cpuOneCorePercent: 100, maxAggregateRssBytes: 40960, maxProcesses: 2 });
});
