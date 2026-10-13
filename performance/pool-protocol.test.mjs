import assert from 'node:assert/strict';
import test from 'node:test';
import { poolSchedule, preparationComparisonSchedule } from './pool-protocol.mjs';

test('pool schedule has three repeats per condition and balances every pool across positions', () => {
    const rows = poolSchedule(3);
    assert.equal(rows.length, 18);
    assert.equal(new Set(rows.map(row => row.caseId)).size, 18);
    for (const scenario of ['C', 'D']) for (const poolMax of [10, 30, 60]) {
        const cases = rows.filter(row => row.scenario === scenario && row.poolMax === poolMax);
        assert.equal(cases.length, 3);
        assert.deepEqual(cases.map(row => row.repeat).sort(), [1, 2, 3]);
        assert.equal(new Set(cases.map(row => row.position)).size, 3);
    }
    assert.deepEqual(rows.slice(0, 6).map(row => `${row.scenario}${row.poolMax}`), ['C10', 'D30', 'C60', 'D10', 'C30', 'D60']);
});

test('selected pool schedule measures only preparation with ten connections', () => {
    const rows = poolSchedule(3, ['C'], [10]);
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => row.scenario === 'C' && row.poolMax === 10 && row.concurrency === 60));
    assert.deepEqual(rows.map(row => row.repeat), [1, 2, 3]);
    assert.deepEqual(rows.map(row => row.position), [1, 1, 1]);
    assert.throws(() => poolSchedule(3, ['X'], [10]));
    assert.throws(() => poolSchedule(3, ['C'], [11]));
});

test('preparation comparison runs both implementations in each counterbalanced round', () => {
    const rows = preparationComparisonSchedule(3);
    assert.deepEqual(rows.map(row => row.variant), ['counter', 'sequence', 'sequence', 'counter', 'counter', 'sequence']);
    for (const variant of ['counter', 'sequence']) assert.deepEqual(rows.filter(row => row.variant === variant).map(row => row.repeat), [1, 2, 3]);
    assert.equal(rows.length, 6);
});

test('distributed pool comparison covers four conditions three times without mixing concurrency', () => {
    const rows = poolSchedule(3, ['B'], [10, 30], [30, 60]);
    assert.equal(rows.length, 12);
    assert.equal(new Set(rows.map(row => row.caseId)).size, 12);
    for (const poolMax of [10, 30]) for (const concurrency of [30, 60]) {
        const cases = rows.filter(row => row.poolMax === poolMax && row.concurrency === concurrency);
        assert.deepEqual(cases.map(row => row.repeat), [1, 2, 3]);
        assert.equal(new Set(cases.map(row => row.position)).size, 3);
        assert.ok(cases.every(row => row.scenario === 'B' && row.caseId === `B-p${poolMax}-c${concurrency}-r${row.repeat}`));
    }
    assert.deepEqual(rows.slice(0, 4).map(row => [row.poolMax, row.concurrency]), [[10, 30], [30, 60], [10, 60], [30, 30]]);
});

test('pool comparison rejects invalid or repeated concurrency conditions', () => {
    assert.throws(() => poolSchedule(3, ['C'], [10, 30], [0]));
    assert.throws(() => poolSchedule(3, ['C'], [10, 30], [30, 30]));
    assert.throws(() => poolSchedule(3, ['C'], [10, 30], []));
});
