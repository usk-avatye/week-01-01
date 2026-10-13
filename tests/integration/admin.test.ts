import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthDto } from '../../src/contracts/auth.js';
import type { CampaignDto, Page } from '../../src/contracts/campaigns.js';
import type { ExecutionDto } from '../../src/contracts/executions.js';
import { hashPassword } from '../../src/server/auth/password.js';
import { createHttpFixture, TEST_PASSWORD } from '../support/http.js';
import { advertiser } from '../support/advertiser.js';
import { execute, prepare, setupCampaign } from '../support/campaign.js';
test('admin reads both advertisers and histories without receiving credential fields', async (t) => {
    const f = await createHttpFixture();
    t.after(() => f.close());
    const a = await advertiser(f), b = await advertiser(f, 'b@example.test', 'B');
    const first = await setupCampaign(a), second = await setupCampaign(b);
    const record = await prepare(a, first.path);
    await execute(a, first.path, record.requestId, 1000);
    await f.pool.query(`INSERT INTO members(email,password_hash,display_name,role) VALUES ('admin@example.test',$1,'Admin','ADMIN')`, [await hashPassword(TEST_PASSWORD)]);
    const logged = await f.login('admin@example.test');
    assert.equal(logged.status, 200);
    const list = await f.request<Page<CampaignDto>>('GET', '/api/admin/campaigns', undefined, logged.cookie);
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 2);
    assert.deepEqual(new Set(list.body.items.map(item => item.ownerId)), new Set([a.member.id, b.member.id]));
    const detail = await f.request<CampaignDto>('GET', `/api/admin/campaigns/${second.campaign.id}`, undefined, logged.cookie);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.ownerName, 'B');
    assert.equal('password_hash' in detail.body, false);
    const history = await f.request<Page<ExecutionDto>>('GET', `/api/admin/campaigns/${first.campaign.id}/executions`, undefined, logged.cookie);
    assert.equal(history.status, 200);
    assert.equal(history.body.items[0]!.approvedAmount, 1000);
});
test('advertiser cannot use admin API and admin cannot mutate advertiser campaigns', async (t) => {
    const f = await createHttpFixture();
    t.after(() => f.close());
    const a = await advertiser(f);
    const { path } = await setupCampaign(a);
    const prepared = await prepare(a, path);
    assert.equal((await a.request('GET', '/api/admin/campaigns')).status, 403);
    await f.pool.query(`INSERT INTO members(email,password_hash,display_name,role) VALUES ('admin@example.test',$1,'Admin','ADMIN')`, [await hashPassword(TEST_PASSWORD)]);
    const logged = await f.login('admin@example.test');
    for (const [method, endpoint, body] of [
        ['POST', '/api/campaigns', { name: 'Unauthorized', totalBudget: 1000 }],
        ['PATCH', path + '/budget', { totalBudget: 20000 }],
        ['PATCH', path + '/status', { status: 'PAUSED' }],
        ['POST', path + '/preparations', {}],
        ['POST', path + '/executions/' + prepared.requestId, { amount: 1000 }],
    ] as const)
        assert.equal((await f.request(method, endpoint, body, logged.cookie, logged.body.csrfToken)).status, 403);
    assert.equal((await a.request<CampaignDto>('GET', path)).body.totalBudget, 10000);
    assert.equal((await a.request<CampaignDto>('GET', path)).body.spentAmount, 0);
});
