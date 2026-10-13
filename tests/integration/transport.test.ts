import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampaignDto, Page } from '../../src/contracts/campaigns.js';
import type { ExecutionDto } from '../../src/contracts/executions.js';
import { createHttpFixture, TEST_ORIGIN } from '../support/http.js';
import { advertiser } from '../support/advertiser.js';
import { execute, prepare, setupCampaign } from '../support/campaign.js';
import { responseProxy } from '../support/transport.js';
test('lost preparation response creates only an unused zero-cost record', async (t) => {
    const f = await createHttpFixture();
    t.after(() => f.close());
    const a = await advertiser(f);
    const { path } = await setupCampaign(a);
    const logged = await f.login();
    const proxy = await responseProxy(f.url, 'drop');
    t.after(() => proxy.close());
    await assert.rejects(fetch(proxy.url + path + '/preparations', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN, Cookie: logged.cookie, 'X-CSRF-Token': logged.body.csrfToken }, body: '{}',
    }));
    const confirmed = await prepare(a, path);
    assert.equal(confirmed.requestId, '2');
    assert.equal((await a.request<CampaignDto>('GET', path)).body.spentAmount, 0);
    assert.equal((await a.request<Page<ExecutionDto>>('GET', path + '/preparations')).body.items.length, 2);
});
test('lost committed spend response is recovered by same ID without a second debit', async (t) => {
    const f = await createHttpFixture();
    t.after(() => f.close());
    const a = await advertiser(f);
    const { path } = await setupCampaign(a);
    const record = await prepare(a, path), endpoint = `${path}/executions/${record.requestId}`;
    const logged = await f.login();
    const proxy = await responseProxy(f.url, 'drop');
    t.after(() => proxy.close());
    await assert.rejects(fetch(proxy.url + endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN, Cookie: logged.cookie, 'X-CSRF-Token': logged.body.csrfToken }, body: '{"amount":1000}',
    }));
    const queried = await a.request<ExecutionDto>('GET', endpoint);
    assert.equal(queried.body.status, 'APPROVED');
    assert.deepEqual((await execute(a, path, record.requestId, 1000)).body, queried.body);
    assert.equal((await a.request<CampaignDto>('GET', path)).body.spentAmount, 1000);
});
test('prepared GET while original POST is delayed does not allow two debits', async (t) => {
    const f = await createHttpFixture();
    t.after(() => f.close());
    const a = await advertiser(f);
    const { path } = await setupCampaign(a);
    const record = await prepare(a, path), endpoint = `${path}/executions/${record.requestId}`;
    const logged = await f.login();
    const proxy = await responseProxy(f.url, 'delay');
    t.after(() => proxy.close());
    const original = fetch(proxy.url + endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN, Cookie: logged.cookie, 'X-CSRF-Token': logged.body.csrfToken }, body: '{"amount":1000}',
    });
    await proxy.received;
    assert.equal((await a.request<ExecutionDto>('GET', endpoint)).body.status, 'PREPARED');
    const repeated = await execute(a, path, record.requestId, 1000);
    assert.equal(repeated.body.status, 'APPROVED');
    proxy.release();
    assert.deepEqual(await (await original).json(), repeated.body);
    assert.equal((await a.request<CampaignDto>('GET', path)).body.spentAmount, 1000);
});
