import assert from 'node:assert/strict';
import test from 'node:test';
import { poolSchedule } from './pool-protocol.mjs';

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
