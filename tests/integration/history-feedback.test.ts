import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { executionHistory } from '../../src/client/execution-history.js';
import { ClientError, type Api } from '../../src/client/api.js';
import type { ExecutionDto } from '../../src/contracts/executions.js';
import { createHttpFixture } from '../support/http.js';
import { advertiser } from '../support/advertiser.js';
import { prepare, setupCampaign } from '../support/campaign.js';

async function historyFixture(t: TestContext, adopt?: (id: string) => Promise<void>) {
    const f = await createHttpFixture(); t.after(() => f.close());
    const client = await advertiser(f), { campaign, path } = await setupCampaign(client);
    for (const amount of [1000, 20000, 1000]) {
        const prepared = await client.request<ExecutionDto>('POST', path + '/preparations', {});
        await client.request('POST', path + '/executions/' + prepared.body.requestId, { amount });
    }
    const dom = new JSDOM('<main></main>');
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
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
    const history = executionHistory(host, context, campaign.id, false, adopt);
    await history.refresh();
    return { f, host, history, client, campaign, path };
}

test('finalized history shows approved and rejected results without execution actions', async t => {
    const { f, host, campaign } = await historyFixture(t);
    const table = host.querySelector('table')!;
    const rows = [...table.querySelectorAll<HTMLTableRowElement>('tbody > tr')];
    assert.equal(rows.length, 3);
    assert.equal(table.querySelector('thead tr')!.children.length, 6);
    for (const row of rows) {
        assert.equal(row.children.length, 6);
        assert.equal(row.querySelector('button'), null);
    }
    assert.match(rows[0]!.textContent ?? '', /승인/);
    assert.match(rows[1]!.textContent ?? '', /거절/);
    assert.match(rows[1]!.textContent ?? '', /예산 부족/);
    assert.equal((await f.pool.query('SELECT spent_amount FROM campaigns WHERE id=$1', [campaign.id])).rows[0].spent_amount, '2000');
});

test('unused preparations stay selectable alongside read-only finalized history', async t => {
    const selected: string[] = [];
    const { host, history, client, path } = await historyFixture(t, async id => { selected.push(id); });
    const prepared = await prepare(client, path);
    await history.refresh();
    const sections = host.querySelectorAll('section');
    const select = sections[1]!.querySelector('tbody button')! as HTMLButtonElement;
    assert.ok(select);
    select.click();
    assert.deepEqual(selected, [prepared.requestId]);
    assert.equal(sections[0]!.querySelector('tbody button'), null);
    assert.equal(sections[0]!.querySelector('thead tr')!.children.length, 6);
});
