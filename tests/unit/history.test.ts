import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { Api } from '../../src/client/api.js';
import { executionHistory } from '../../src/client/execution-history.js';

test('a failed preparation refresh is visible after an empty list and clears after recovery', async t => {
    const dom = new JSDOM('<main></main>');
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, 'document', previous);
        else Reflect.deleteProperty(globalThis, 'document');
        dom.window.close();
    });
    let unavailable = false;
    const api: Api = { async request<T>(_method: string, path: string): Promise<T> {
        if (path === '/campaigns/1/preparations?page=1' && unavailable) throw new Error('준비 목록 조회 실패');
        if (!['/campaigns/1/preparations?page=1', '/campaigns/1/executions?page=1'].includes(path)) throw new Error('Unexpected endpoint');
        return { items: [], page: 1, limit: 20, hasNext: false } as T;
    } };
    const host = dom.window.document.querySelector('main')!;
    const history = executionHistory(host, {
        member: { id: '1', email: 'member@example.test', displayName: '시연 광고주', role: 'ADVERTISER' },
        api, signal: new AbortController().signal,
    }, '1');
    await history.refresh();
    assert.equal(host.querySelectorAll('section')[1]!.hidden, true);
    unavailable = true;
    await history.refresh();
    const alert = host.querySelector<HTMLElement>('[role="alert"]');
    assert.ok(alert);
    assert.equal(alert.textContent, '준비 목록 조회 실패');
    assert.equal(alert.closest('section')!.hidden, false, 'The failure must not be hidden with the previously empty list');
    unavailable = false;
    await history.refresh();
    assert.equal(host.querySelector('[role="alert"]'), null);
    assert.equal(host.querySelectorAll('section')[1]!.hidden, true);
});
