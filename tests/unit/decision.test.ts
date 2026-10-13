import assert from 'node:assert/strict';
import test from 'node:test';
import { decideExecution } from '../../src/server/executions/decision.js';
import { parseAmount, parseId } from '../../src/server/http/input.js';
test('an active campaign approves the full affordable amount', () => {
    assert.deepEqual(decideExecution({ status: 'ACTIVE', totalBudget: 10000, spentAmount: 0 }, 1000), { status: 'APPROVED', approvedAmount: 1000, rejectionReason: null });
});
test('paused takes priority over insufficient budget', () => {
    assert.deepEqual(decideExecution({ status: 'PAUSED', totalBudget: 10000, spentAmount: 9500 }, 1000), { status: 'REJECTED', approvedAmount: 0, rejectionReason: 'CAMPAIGN_PAUSED' });
});
test('insufficient budget rejects without approving a partial amount', () => {
    assert.deepEqual(decideExecution({ status: 'ACTIVE', totalBudget: 10000, spentAmount: 9500 }, 1000), { status: 'REJECTED', approvedAmount: 0, rejectionReason: 'INSUFFICIENT_BUDGET' });
});
test('exactly the remaining budget is affordable', () => {
    assert.equal(decideExecution({ status: 'ACTIVE', totalBudget: 10000, spentAmount: 9000 }, 1000).status, 'APPROVED');
});
test('amount parsing rejects zero, fractions, strings and values beyond the cap', () => {
    for (const value of [0, -1, 1.5, '1000', null, 1000000001, Number.NaN]) {
        assert.throws(() => parseAmount(value));
    }
    assert.equal(parseAmount(1), 1);
    assert.equal(parseAmount(1000000000), 1000000000);
});
test('large database IDs remain precise strings', () => {
    assert.equal(parseId('9007199254740993'), '9007199254740993');
    for (const value of ['0', '-1', '1.5', '9223372036854775808', '1 OR 1=1', ['1']]) {
        assert.throws(() => parseId(value));
    }
});
