import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { loadPending, savePending, clearPending, type PendingRequest } from '../../src/client/pending-store.js';
const request: PendingRequest = { memberId: '1', campaignId: '42', requestId: '101', phase: 'UNRESOLVED', amount: 1000 };
const storage = () => new JSDOM('', { url: 'http://localhost' }).window.localStorage;
test('pending identity is durable and isolated by member and campaign', () => {
    const store = storage();
    savePending(store, request);
    assert.deepEqual(loadPending(store, '1', '42'), { kind: 'valid', request });
    assert.deepEqual(loadPending(store, '2', '42'), { kind: 'empty' });
    assert.deepEqual(loadPending(store, '1', '43'), { kind: 'empty' });
});
test('an unresolved identity cannot be replaced by a new number or changed amount', () => {
    const store = storage();
    savePending(store, request);
    assert.throws(() => savePending(store, { ...request, requestId: '102', phase: 'PREPARED', amount: null }));
    assert.throws(() => savePending(store, { ...request, amount: 2000 }));
    assert.deepEqual(loadPending(store, '1', '42'), { kind: 'valid', request });
});
test('an old receipt cannot clear a different pending identity', () => {
    const store = storage();
    savePending(store, request);
    clearPending(store, request);
    const next = { ...request, requestId: '102' };
    savePending(store, next);
    clearPending(store, request);
    assert.deepEqual(loadPending(store, '1', '42'), { kind: 'valid', request: next });
});
test('corrupt or wrong-owner storage is surfaced instead of silently becoming an empty flow', () => {
    const store = storage();
    savePending(store, request);
    const key = store.key(0)!;
    store.setItem(key, '{broken');
    assert.equal(loadPending(store, '1', '42').kind, 'corrupt');
    store.setItem(key, JSON.stringify({ ...request, memberId: '2' }));
    assert.equal(loadPending(store, '1', '42').kind, 'corrupt');
});
