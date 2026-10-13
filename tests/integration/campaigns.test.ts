import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampaignDto, Page } from '../../src/contracts/campaigns.js';
import { createHttpFixture } from '../support/http.js';
import { advertiser } from '../support/advertiser.js';
test('new campaigns are paused and only the owner can read or modify them', async (t) => {
    const f = await createHttpFixture();
    t.after(() => f.close());
    const a = await advertiser(f), b = await advertiser(f, 'b@example.test', 'B');
    const created = await a.request<CampaignDto>('POST', '/api/campaigns', { name: 'Launch', totalBudget: 10000 });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'PAUSED');
    assert.equal(created.body.spentAmount, 0);
    assert.equal(created.body.remainingBudget, 10000);
    const path = `/api/campaigns/${created.body.id}`;
    assert.equal((await a.request('GET', path)).status, 200);
    assert.equal((await b.request('GET', path)).status, 404);
    assert.equal((await b.request('PATCH', path + '/status', { status: 'ACTIVE' })).status, 404);
    assert.equal((await b.request('PATCH', path + '/budget', { totalBudget: 20000 })).status, 404);
    const list = await b.request<Page<CampaignDto>>('GET', '/api/campaigns');
    assert.equal(list.body.items.length, 0);
    assert.equal((await f.request('GET', '/api/campaigns')).status, 401);
});
test('budget edits require paused state and cannot erase already spent money', async (t) => {
    const f = await createHttpFixture();
    t.after(() => f.close());
    const a = await advertiser(f);
    const created = await a.request<CampaignDto>('POST', '/api/campaigns', { name: 'Budget', totalBudget: 10000 });
    assert.equal(created.status, 201);
    const path = `/api/campaigns/${created.body.id}`;
    assert.equal((await a.request('PATCH', path + '/status', { status: 'ACTIVE' })).status, 200);
    assert.equal((await a.request('PATCH', path + '/budget', { totalBudget: 20000 })).status, 409);
    await a.request('PATCH', path + '/status', { status: 'PAUSED' });
    await f.pool.query('UPDATE campaigns SET spent_amount=5000,last_execution_no=1 WHERE id=$1', [created.body.id]);
    await f.pool.query(`INSERT INTO executions(campaign_id,execution_no,status,requested_amount,approved_amount,processed_at) VALUES ($1,1,'APPROVED',5000,5000,clock_timestamp())`, [created.body.id]);
    assert.equal((await a.request('PATCH', path + '/budget', { totalBudget: 4999 })).status, 409);
    const changed = await a.request<CampaignDto>('PATCH', path + '/budget', { totalBudget: 20000 });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.spentAmount, 5000);
    assert.equal(changed.body.remainingBudget, 15000);
});
test('campaign inputs reject forged ownership and unsafe or fractional amounts', async (t) => {
    const f = await createHttpFixture();
    t.after(() => f.close());
    const a = await advertiser(f);
    for (const totalBudget of [0, 1.5, '1000', 1000000001]) {
        assert.equal((await a.request('POST', '/api/campaigns', { name: 'Bad', totalBudget })).status, 400);
    }
    assert.equal((await a.request('POST', '/api/campaigns', { name: 'Forged', totalBudget: 1000, ownerId: '2' })).status, 400);
    assert.equal((await a.request('GET', '/api/campaigns/1%20OR%201=1')).status, 400);
    assert.equal((await a.request('GET', '/api/campaigns?page=-1')).status, 400);
});
test('campaign IDs above the JavaScript safe integer limit round-trip exactly', async (t) => {
    const f = await createHttpFixture();
    t.after(() => f.close());
    const a = await advertiser(f);
    await f.pool.query(`INSERT INTO campaigns(id,owner_id,name,total_budget) OVERRIDING SYSTEM VALUE VALUES (9007199254740993,$1,'Large ID',1000)`, [a.member.id]);
    const result = await a.request<CampaignDto>('GET', '/api/campaigns/9007199254740993');
    assert.equal(result.status, 200);
    assert.equal(result.body.id, '9007199254740993');
});
