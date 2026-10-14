import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import type { ExecutionDto } from '../../src/contracts/executions.js';
import { type Api, ClientError } from '../../src/client/api.js';
import { executionController } from '../../src/client/execution-controller.js';
import { renderExecutionPanel } from '../../src/client/execution-panel.js';
import { loadPending, savePending } from '../../src/client/pending-store.js';

const base = '/campaigns/42';
const prepared: ExecutionDto = { campaignId: '42', requestId: '101', status: 'PREPARED', requestedAmount: null, approvedAmount: 0, rejectionReason: null, createdAt: '2026-10-13T01:00:00Z', processedAt: null };
const approved: ExecutionDto = { ...prepared, status: 'APPROVED', requestedAmount: 2500, approvedAmount: 2500, processedAt: '2026-10-13T01:00:01Z' };
const pending = { memberId: '1', campaignId: '42', requestId: '101', phase: 'UNRESOLVED' as const, amount: 2500 };

function panel(t: TestContext, respond: (method: string, path: string, body: unknown, storage: Storage) => unknown | Promise<unknown>, completed = async () => {}) {
    const dom = new JSDOM('<div id="panel"></div>', { url: 'http://localhost:3000' });
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, 'document', previous);
        else Reflect.deleteProperty(globalThis, 'document');
        dom.window.close();
    });
    const host = dom.window.document.querySelector<HTMLElement>('#panel')!, storage = dom.window.localStorage;
    const api: Api = { async request<T>(method: string, path: string, body?: unknown) { return await respond(method, path, body, storage) as T; } };
    const context = { member: { id: '1', email: 'a@example.test', displayName: '광고주', role: 'ADVERTISER' as const }, api, signal: new AbortController().signal };
    function restore() {
        const controller = executionController(context, '42', storage, () => renderExecutionPanel(host, controller), completed);
        renderExecutionPanel(host, controller);
        return controller;
    }
    function submit(amount: number) {
        const form = host.querySelector('form');
        assert.ok(form, '금액을 입력해 바로 집행할 수 있어야 합니다.');
        form.querySelector('input')!.value = String(amount);
        form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    }
    return { host, storage, dom, restore, submit, controller: restore() };
}

async function idle(controller: ReturnType<typeof executionController>): Promise<void> {
    const deadline = Date.now() + 3000;
    while (controller.snapshot().busy) {
        if (Date.now() >= deadline) throw new Error('집행 처리가 끝나지 않았습니다.');
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

test('one submit prepares internally and persists the number and amount before sending', async t => {
    const calls: string[] = [];
    const p = panel(t, (method, path, body, storage) => {
        calls.push(`${method} ${path}`);
        if (path === base + '/preparations') return prepared;
        assert.equal(path, base + '/executions/101');
        assert.deepEqual(body, { amount: 2500 });
        assert.deepEqual(loadPending(storage, '1', '42'), { kind: 'valid', request: pending });
        return approved;
    });
    assert.equal(p.host.querySelector('button')?.textContent, '집행 요청');
    p.submit(2500);
    await idle(p.controller);
    assert.deepEqual(calls, ['POST /campaigns/42/preparations', 'POST /campaigns/42/executions/101']);
    assert.deepEqual(p.controller.snapshot().receipt, approved);
    assert.equal(loadPending(p.storage, '1', '42').kind, 'empty');
    assert.ok(p.host.querySelector('form'), '확정 후 다음 집행 금액을 입력할 수 있어야 합니다.');
    assert.deepEqual([...p.host.querySelectorAll('button')].map(button => button.textContent), ['집행 요청']);
});

test('submitting again during preparation cannot start a second execution', async t => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const calls: string[] = [];
    const p = panel(t, async (method, path) => {
        calls.push(`${method} ${path}`);
        if (path === base + '/preparations') { await gate; return prepared; }
        return approved;
    });
    p.submit(2500);
    assert.equal(p.host.querySelector('button')!.disabled, true);
    assert.equal(p.host.querySelector('input')!.disabled, true);
    assert.equal(p.host.querySelector('input')!.value, '2500');
    p.submit(2500);
    release();
    await idle(p.controller);
    assert.deepEqual(calls, ['POST /campaigns/42/preparations', 'POST /campaigns/42/executions/101']);
    assert.deepEqual(p.controller.snapshot().receipt, approved);
});

test('a lost execution response survives reload and resends the saved number and amount', async t => {
    let lost = true;
    const calls: string[] = [];
    const p = panel(t, (method, path, body) => {
        calls.push(`${method} ${path}`);
        if (path === base + '/preparations') return prepared;
        assert.deepEqual(body, { amount: 2500 });
        if (lost) { lost = false; throw new ClientError(0, 'NETWORK_UNKNOWN', '응답 유실'); }
        return approved;
    });
    p.submit(2500);
    await idle(p.controller);
    assert.equal(p.controller.snapshot().error, true);
    assert.deepEqual(loadPending(p.storage, '1', '42'), { kind: 'valid', request: pending });
    const restored = p.restore();
    assert.equal(p.host.querySelector('input')!.value, '2500');
    assert.equal(p.host.querySelector('input')!.disabled, true);
    assert.deepEqual([...p.host.querySelectorAll('button')].map(button => button.textContent), ['다시 시도', '결과 확인']);
    p.submit(9999);
    await idle(restored);
    assert.deepEqual(calls, ['POST /campaigns/42/preparations', 'POST /campaigns/42/executions/101', 'POST /campaigns/42/executions/101']);
    assert.deepEqual(restored.snapshot().receipt, approved);
    assert.equal(loadPending(p.storage, '1', '42').kind, 'empty');
    assert.deepEqual([...p.host.querySelectorAll('button')].map(button => button.textContent), ['집행 요청']);
});

test('result confirmation keeps unresolved controls until the saved request is finalized', async t => {
    let result = prepared;
    const calls: string[] = [];
    const p = panel(t, (method, path) => {
        calls.push(`${method} ${path}`);
        return result;
    });
    savePending(p.storage, pending);
    const restored = p.restore();
    const confirm = () => [...p.host.querySelectorAll('button')].find(button => button.textContent === '결과 확인');
    assert.ok(confirm(), '미확정 요청의 결과 확인 버튼이 필요합니다.');
    confirm()!.click();
    await idle(restored);
    assert.deepEqual(loadPending(p.storage, '1', '42'), { kind: 'valid', request: pending });
    assert.equal(p.host.querySelector('input')!.disabled, true);
    assert.deepEqual([...p.host.querySelectorAll('button')].map(button => button.textContent), ['다시 시도', '결과 확인']);
    result = approved;
    confirm()!.click();
    await idle(restored);
    assert.deepEqual(calls, ['GET /campaigns/42/executions/101', 'GET /campaigns/42/executions/101']);
    assert.deepEqual(restored.snapshot().receipt, approved);
    assert.equal(loadPending(p.storage, '1', '42').kind, 'empty');
    assert.deepEqual([...p.host.querySelectorAll('button')].map(button => button.textContent), ['집행 요청']);
});

test('terminal confirmation hides recovery controls while campaign and history refresh is delayed', async t => {
    let release!: () => void, reached!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const refreshing = new Promise<void>(resolve => { reached = resolve; });
    const p = panel(t, () => approved, async () => { reached(); await hold; });
    savePending(p.storage, pending);
    const restored = p.restore();
    [...p.host.querySelectorAll('button')].find(button => button.textContent === '결과 확인')!.click();
    await refreshing;
    try {
        assert.equal(restored.snapshot().busy, true);
        assert.equal(loadPending(p.storage, '1', '42').kind, 'empty');
        assert.deepEqual([...p.host.querySelectorAll('button')].map(button => button.textContent), ['집행 요청']);
        assert.match(p.host.querySelector('.receipt')?.textContent ?? '', /승인/);
    }
    finally {
        release();
        await idle(restored);
    }
});

test('a failed preparation leaves a retryable form and sends no execution', async t => {
    const calls: string[] = [];
    const p = panel(t, (method, path) => {
        calls.push(`${method} ${path}`);
        throw new ClientError(0, 'NETWORK_UNKNOWN', '번호 발급 응답 유실');
    });
    p.submit(2500);
    await idle(p.controller);
    assert.equal(p.controller.snapshot().error, true);
    assert.equal(loadPending(p.storage, '1', '42').kind, 'empty');
    assert.equal(p.host.querySelector('button')!.disabled, false);
    assert.equal(p.host.querySelector('input')!.value, '2500');
    assert.deepEqual(calls, ['POST /campaigns/42/preparations']);
});

test('invalid amounts are rejected before requesting a number', async t => {
    let requests = 0;
    const p = panel(t, () => { requests++; return prepared; });
    for (const amount of [0, 1.5, 1000000001]) {
        p.submit(amount);
        await idle(p.controller);
        assert.equal(p.controller.snapshot().error, true);
    }
    assert.equal(requests, 0);
    assert.equal(loadPending(p.storage, '1', '42').kind, 'empty');
});

test('storage failure prevents sending an execution after preparing a number', async t => {
    const calls: string[] = [];
    const p = panel(t, (method, path) => { calls.push(`${method} ${path}`); return prepared; });
    p.dom.window.Storage.prototype.setItem = () => { throw new Error('저장 공간 부족'); };
    p.submit(2500);
    await idle(p.controller);
    assert.equal(p.controller.snapshot().error, true);
    assert.deepEqual(calls, ['POST /campaigns/42/preparations']);
    assert.equal(loadPending(p.storage, '1', '42').kind, 'empty');
});

test('another tab selecting a request during preparation keeps its number intact', async t => {
    const calls: string[] = [];
    const other = { ...pending, requestId: '102', phase: 'PREPARED' as const, amount: null };
    const p = panel(t, (method, path, _body, storage) => {
        calls.push(`${method} ${path}`);
        savePending(storage, other);
        return prepared;
    });
    p.submit(2500);
    await idle(p.controller);
    assert.equal(p.controller.snapshot().error, true);
    assert.deepEqual(loadPending(p.storage, '1', '42'), { kind: 'valid', request: other });
    assert.deepEqual(calls, ['POST /campaigns/42/preparations']);
});
