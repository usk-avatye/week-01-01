import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { executionHistory } from '../../src/client/execution-history.js';
import { ClientError, type Api } from '../../src/client/api.js';
import type { ExecutionDto } from '../../src/contracts/executions.js';
import { createHttpFixture } from '../support/http.js';
import { advertiser } from '../support/advertiser.js';
import { setupCampaign } from '../support/campaign.js';

async function historyFixture(t: TestContext) {
    const f = await createHttpFixture(); t.after(() => f.close());
    const client = await advertiser(f), { campaign, path } = await setupCampaign(client);
    for (const amount of [1000, 20000, 1000]) {
        const prepared = await client.request<ExecutionDto>('POST', path + '/preparations', {});
        await client.request('POST', path + '/executions/' + prepared.body.requestId, { amount });
    }
    const dom = new JSDOM('<main></main>');
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
    // JSDOM has no layout; visibility and scrolling are checked in Chrome.
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, 'document', previous);
        else Reflect.deleteProperty(globalThis, 'document');
        dom.window.close();
    });
    const api: Api = { async request<T>(method: string, endpoint: string, body?: unknown) {
        const reply = await client.request<T>(method, '/api' + endpoint, body);
        if (reply.status >= 400) throw new ClientError(reply.status, 'HTTP_FAILURE', '테스트 HTTP 실패');
        return reply.body;
    } };
    const context = { member: client.member, api, signal: new AbortController().signal };
    const host = dom.window.document.querySelector('main')!;
    await executionHistory(host, context, campaign.id).refresh();
    const rows = [...host.querySelectorAll<HTMLTableRowElement>('tbody > tr')];
    return { f, host, rows, context, campaign };
}

async function settled(button: HTMLButtonElement): Promise<void> {
    const deadline = Date.now() + 3000;
    while (button.disabled) {
        if (Date.now() >= deadline) throw new Error('Replay did not settle');
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

test('approved and rejected replay results appear beside their triggering rows without changing spend', async t => {
    const { f, host, rows, campaign } = await historyFixture(t);
    const approved = rows[0]!.querySelector('button')!;
    approved.click(); await settled(approved);
    assert.match(rows[0]!.nextElementSibling?.textContent ?? '', /요청 #3: 승인/);
    assert.equal(rows[0]!.nextElementSibling?.querySelector('td')?.colSpan, 7);
    const rejected = rows[1]!.querySelector('button')!;
    rejected.click(); await settled(rejected);
    assert.match(rows[1]!.nextElementSibling?.textContent ?? '', /요청 #2: 거절/);
    assert.match(rows[1]!.nextElementSibling?.textContent ?? '', /예산 부족/);
    assert.equal(host.querySelectorAll('.receipt').length, 1, 'Only the latest replay result remains open');
    assert.equal((await f.pool.query('SELECT spent_amount FROM campaigns WHERE id=$1', [campaign.id])).rows[0].spent_amount, '2000');
});

test('replay failure appears beside the triggering row and is replaced by a successful retry', async t => {
    const { rows, context } = await historyFixture(t);
    const request = context.api.request;
    let unavailable = true;
    context.api.request = async <T>(method: string, endpoint: string, body?: unknown): Promise<T> => {
        if (method === 'POST' && unavailable) throw new Error('재전송 통신 오류');
        return request<T>(method, endpoint, body);
    };
    const replay = rows[0]!.querySelector('button')!;
    replay.click(); await settled(replay);
    const alert = rows[0]!.nextElementSibling?.querySelector('[role="alert"]');
    assert.equal(alert?.textContent, '재전송 통신 오류');
    unavailable = false;
    replay.click(); await settled(replay);
    assert.equal(rows[0]!.nextElementSibling?.querySelector('[role="alert"]'), null);
    assert.match(rows[0]!.nextElementSibling?.textContent ?? '', /요청 #3: 승인/);
});

test('a delayed earlier replay response cannot replace the latest selected row result', async t => {
    const { host, rows, context } = await historyFixture(t);
    const request = context.api.request;
    let release!: () => void, reached!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const received = new Promise<void>(resolve => { reached = resolve; });
    context.api.request = async <T>(method: string, endpoint: string, body?: unknown): Promise<T> => {
        const reply = await request<T>(method, endpoint, body);
        if (method === 'POST' && endpoint.endsWith('/executions/3')) { reached(); await hold; }
        return reply;
    };
    const earlier = rows[0]!.querySelector('button')!, latest = rows[1]!.querySelector('button')!;
    earlier.click(); await received;
    latest.click(); await settled(latest);
    release(); await settled(earlier);
    assert.match(rows[1]!.nextElementSibling?.textContent ?? '', /요청 #2: 거절/);
    assert.equal(host.querySelectorAll('.receipt').length, 1);
    assert.doesNotMatch(host.querySelector('.receipt')?.textContent ?? '', /요청 #3/);
});
