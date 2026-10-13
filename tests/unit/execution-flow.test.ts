import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionDto } from '../../src/contracts/executions.js';
import { acceptExecutionResult } from '../../src/client/execution-flow.js';
import type { PendingRequest } from '../../src/client/pending-store.js';
const request: PendingRequest = { memberId: '1', campaignId: '42', requestId: '101', phase: 'UNRESOLVED', amount: 1000 };
const prepared: ExecutionDto = { campaignId: '42', requestId: '101', status: 'PREPARED', requestedAmount: null, approvedAmount: 0, rejectionReason: null, createdAt: '2026-10-13T01:00:00Z', processedAt: null };
test('prepared GET does not release the unresolved number or amount', () => {
    assert.deepEqual(acceptExecutionResult(request, prepared), { kind: 'UNRESOLVED', request });
});
test('valid matching terminal result releases only that pending flow', () => {
    const result: ExecutionDto = { ...prepared, status: 'APPROVED', requestedAmount: 1000, approvedAmount: 1000, processedAt: '2026-10-13T01:00:01Z' };
    assert.deepEqual(acceptExecutionResult(request, result), { kind: 'TERMINAL', result });
});
test('wrong number, amount or malformed terminal result cannot unlock another spend', () => {
    const valid: ExecutionDto = { ...prepared, status: 'APPROVED', requestedAmount: 1000, approvedAmount: 1000, processedAt: '2026-10-13T01:00:01Z' };
    for (const result of [{ ...valid, requestId: '102' }, { ...valid, requestedAmount: 2000 }, { ...valid, approvedAmount: 0 }, { ...valid, processedAt: null }]) {
        assert.throws(() => acceptExecutionResult(request, result));
    }
});
